// 全域狀態管理
let baseAnswerKey = []; 
let isBaseAnswerReady = false;

// 物理幾何常數 (對標 800x1100 標準映射解析度)
const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 1100;

const GRID = {
    colStarts: [35, 223, 411, 599], // 四大縱列 X 理論起點
    qNumberWidth: 32,              // 題號字元佔寬
    roiSize: 18                    // 感應方塊大小 (18x18 像素)
};

// 微調控制項動態變數
let caliX = 0;
let caliY = 0;
let caliOptGap = 38;
let caliRowHeight = 34.6;
let caliThreshold = 60; // 判定為劃記的「黑點像素總量門檻」

const GRID_START_Y_BASE = 195; // 縱列第 1 題垂直 Y 起點

// 🗄️ 隱藏的離線乾淨畫布快取 (專門用來讀取純淨像素，防止畫線干擾)
let offscreenAnswerCanvas = document.createElement('canvas');
let offscreenStudentCanvas = document.createElement('canvas');
offscreenAnswerCanvas.width = TARGET_WIDTH;
offscreenAnswerCanvas.height = TARGET_HEIGHT;
offscreenStudentCanvas.width = TARGET_WIDTH;
offscreenStudentCanvas.height = TARGET_HEIGHT;

let cachedAnswerImg = null;
let cachedStudentImg = null;

// DOM 元素繫結
const uploadAnswer = document.getElementById('upload-answer');
const uploadStudent = document.getElementById('upload-student');
const btnNextStudent = document.getElementById('btn-next-student');
const btnFullReset = document.getElementById('btn-full-reset');
const resultPanel = document.getElementById('result-panel');
const ansStatus = document.getElementById('ans-status');

// 綁定校準滑桿事件
const sliders = ['cali-x', 'cali-y', 'cali-opt-gap', 'cali-row-height', 'cali-threshold'];
sliders.forEach(id => {
    document.getElementById(id).addEventListener('input', updateCalibrationAndRerender);
});
document.getElementById('input-total-questions').addEventListener('input', updateCalibrationAndRerender);

/**
 * 🚀 Canvas 核心引擎：拉動滑桿免重新上傳，瞬間抹除、重新繪製並結算成績
 */
function updateCalibrationAndRerender() {
    caliX = parseInt(document.getElementById('cali-x').value);
    caliY = parseInt(document.getElementById('cali-y').value);
    caliOptGap = parseFloat(document.getElementById('cali-opt-gap').value);
    caliRowHeight = parseFloat(document.getElementById('cali-row-height').value);
    caliThreshold = parseInt(document.getElementById('cali-threshold').value);
    
    document.getElementById('val-x').innerText = caliX;
    document.getElementById('val-y').innerText = caliY;
    document.getElementById('val-opt-gap').innerText = caliOptGap;
    document.getElementById('val-row-height').innerText = caliRowHeight;
    document.getElementById('val-threshold').innerText = caliThreshold;
    
    const totalQs = parseInt(document.getElementById('input-total-questions').value) || 20;
    
    // 1. 校準並重新辨識標準答案
    if (cachedAnswerImg) {
        const canvas = document.getElementById('canvas-answer');
        baseAnswerKey = scanPaperAnswersCanvas(cachedAnswerImg, offscreenAnswerCanvas, canvas, totalQs, true);
        isBaseAnswerReady = true;
        ansStatus.innerText = `✅ 已就緒 (${baseAnswerKey.filter(x => x !== null).length} 題)`;
        ansStatus.className = "badge badge-success";
    }
    
    // 2. 同步校準並重新閱卷學生卡
    if (cachedStudentImg && isBaseAnswerReady) {
        const canvas = document.getElementById('canvas-student');
        const studentAnswers = scanPaperAnswersCanvas(cachedStudentImg, offscreenStudentCanvas, canvas, totalQs, false);
        gradeStudentCard(studentAnswers, totalQs);
    }
}

// 處理正確答案卡上傳
uploadAnswer.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const img = new Image();
    img.onload = function() {
        cachedAnswerImg = img;
        
        // 隱藏虛線大方框，亮出 Canvas
        document.querySelector('.drop-wrapper-ans').classList.add('hidden');
        const canvas = document.getElementById('canvas-answer');
        canvas.classList.remove('hidden');
        canvas.width = TARGET_WIDTH;
        canvas.height = TARGET_HEIGHT;
        
        // 將乾淨圖像快取至離線畫布
        const offCtx = offscreenAnswerCanvas.getContext('2d');
        offCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        offCtx.drawImage(img, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        
        updateCalibrationAndRerender();
    };
    img.src = URL.createObjectURL(file);
});

// 處理學生答案卡上傳
uploadStudent.addEventListener('change', (e) => {
    if (!isBaseAnswerReady) {
        alert('請先在右側設定「正確答案卡」基準！');
        uploadStudent.value = '';
        return;
    }
    
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = function() {
        cachedStudentImg = img;
        
        document.querySelector('.drop-wrapper').classList.add('hidden');
        const canvas = document.getElementById('canvas-student');
        canvas.classList.remove('hidden');
        canvas.width = TARGET_WIDTH;
        canvas.height = TARGET_HEIGHT;
        
        const offCtx = offscreenStudentCanvas.getContext('2d');
        offCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        offCtx.drawImage(img, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        
        updateCalibrationAndRerender();
    };
    img.src = URL.createObjectURL(file);
});

/**
 * 🔍 智慧像素掃描核心 (100% 純原生 Canvas 技術)
 */
function scanPaperAnswersCanvas(imgEl, offscreenCanvas, onscreenCanvas, totalQs, isBaseConfig = false) {
    const onscreenCtx = onscreenCanvas.getContext('2d');
    const offscreenCtx = offscreenCanvas.getContext('2d');
    
    // 每次刷新，先在可見畫布上重繪乾淨原圖
    onscreenCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    onscreenCtx.drawImage(imgEl, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    
    const options = ['A', 'B', 'C', 'D'];
    let paperAnswers = [];
    
    for (let q = 1; q <= totalQs; q++) {
        let colIdx = Math.floor((q - 1) / 25); // 第幾縱列
        let rowIdx = (q - 1) % 25;            // 列中的第幾行
        
        // 匯入微調偏移常數
        let colXStart = GRID.colStarts[colIdx] + caliX;
        let rowTopY = GRID_START_Y_BASE + (rowIdx * caliRowHeight) + caliY;
        let optY = rowTopY + (caliRowHeight - GRID.roiSize) / 2;
        
        let maxDarkPixels = 0;
        let detectedOptionIndex = -1;
        let optionPixelCounts = [];
        
        for (let o = 0; o < 4; o++) {
            let optX = colXStart + GRID.qNumberWidth + (o * caliOptGap) + (caliOptGap - GRID.roiSize) / 2;
            
            // 範圍安全限制作業，防止超出 800x1100 邊界
            let safeX = Math.max(0, Math.min(optX, TARGET_WIDTH - GRID.roiSize));
            let safeY = Math.max(0, Math.min(optY, TARGET_HEIGHT - GRID.roiSize));
            
            // 💡 關鍵突破：從「離線畫布」擷取純淨像素資料，絕不受到外面彩色偵測框的干擾！
            let imgData = offscreenCtx.getImageData(safeX, safeY, GRID.roiSize, GRID.roiSize);
            let pixels = imgData.data;
            let darkPixelCount = 0;
            
            // 遍歷 18x18 感應區內的所有像素 (每 4 格代表一組 RGBA)
            for (let i = 0; i < pixels.length; i += 4) {
                let r = pixels[i];
                let g = pixels[i+1];
                let b = pixels[i+2];
                
                // 工業標準灰階亮度公式 (Luminance)
                let grayscale = 0.299 * r + 0.587 * g + 0.114 * b;
                
                // 如果亮度低於 130，代表該點被鉛筆/原子筆塗黑了
                if (grayscale < 130) {
                    darkPixelCount++;
                }
            }
            
            optionPixelCounts.push({ index: o, count: darkPixelCount, x: safeX, y: safeY });
            
            if (darkPixelCount > maxDarkPixels) {
                maxDarkPixels = darkPixelCount;
                detectedOptionIndex = o;
            }
            
            // 在畫面上永續繪製淡橙色半透明感應瞄準框
            onscreenCtx.strokeStyle = 'rgba(217, 119, 6, 0.25)'; 
            onscreenCtx.lineWidth = 1;
            onscreenCtx.strokeRect(safeX, safeY, GRID.roiSize, GRID.roiSize);
        }
        
        // 閥值過濾：如果最黑的那格，塗黑點數大於滑桿設定值，才判定為有劃記
        if (maxDarkPixels > caliThreshold) {
            paperAnswers.push(options[detectedOptionIndex]);
            
            // 將判定的答案用粗外框高亮圈起來
            let bestOpt = optionPixelCounts[detectedOptionIndex];
            onscreenCtx.strokeStyle = isBaseConfig ? '#10b981' : '#4f46e5'; // 標準答案綠，學生卡藍
            onscreenCtx.lineWidth = 2.5;
            onscreenCtx.strokeRect(bestOpt.x - 1, bestOpt.y - 1, GRID.roiSize + 2, GRID.roiSize + 2);
        } else {
            paperAnswers.push(null); // 空白題
        }
    }
    
    return paperAnswers;
}

/**
 * 結算學生成績與渲染報告清單
 */
function gradeStudentCard(studentAnswers, totalQs) {
    const scorePerQ = parseFloat(document.getElementById('input-score-per-question').value) || 5;
    const wrongList = document.getElementById('wrong-list');
    
    wrongList.innerHTML = '';
    let wrongCount = 0;
    let correctCount = 0;

    for (let i = 0; i < totalQs; i++) {
        const studentAns = studentAnswers[i] || '未劃記'; 
        const correctAns = baseAnswerKey[i];
        
        if (studentAns === correctAns) {
            correctCount++;
        } else {
            wrongCount++;
            const li = document.createElement('li');
            li.innerHTML = `<span>第 <strong>${i+1}</strong> 題</span> <span>正確 [${correctAns || '未設'}] ➔ 讀到 [${studentAns}]</span>`;
            wrongList.appendChild(li);
        }
    }

    let finalScore = correctCount * scorePerQ;
    if (finalScore > 100) finalScore = 100;

    document.getElementById('score-text').innerText = finalScore;
    document.getElementById('wrong-count').innerText = `${wrongCount} 題`;
    resultPanel.classList.remove('hidden');
}

// 換下一張學生卡
btnNextStudent.addEventListener('click', () => {
    uploadStudent.value = '';
    cachedStudentImg = null;
    
    const canvas = document.getElementById('canvas-student');
    canvas.classList.add('hidden');
    document.querySelector('.drop-wrapper').classList.remove('hidden');
    resultPanel.classList.add('hidden');
});

// 完全重設
btnFullReset.addEventListener('click', () => {
    cachedAnswerImg = null;
    cachedStudentImg = null;
    location.reload(); 
});
