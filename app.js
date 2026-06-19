// 全域狀態管理
let baseAnswerKey = []; 
let isBaseAnswerReady = false;

// 物理幾何目標標準尺寸（強制映射解析度系）
const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 1100;

// OMR 卡片內固定的微幅常數
const GRID_CONSTANT = {
    qNumberWidth: 32,  // 題號字元寬度
    roiSize: 18        // 氣泡感應區域大小 (18x18 像素)
};

// 🛠️ 動態包絡線校準控制變數
let caliLeft = 50;
let caliWidth = 600;
let caliTop = 190;
let caliHeight = 830;
let caliSkew = 0;       // 紙張左右傾斜修正量
let caliOptGap = 36;
let caliThreshold = 50; // 劃記判定點數門檻

// 🗄️ 離線快取畫布（防污損像素讀取核心）
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

// 綁定所有新型控制滑桿
const sliders = ['cali-left', 'cali-width', 'cali-top', 'cali-height', 'cali-skew', 'cali-opt-gap', 'cali-threshold'];
sliders.forEach(id => {
    document.getElementById(id).addEventListener('input', updateCalibrationAndRerender);
});
document.getElementById('input-total-questions').addEventListener('input', updateCalibrationAndRerender);

/**
 * 🚀 包絡線網格動態連動引擎
 */
function updateCalibrationAndRerender() {
    caliLeft = parseInt(document.getElementById('cali-left').value);
    caliWidth = parseInt(document.getElementById('cali-width').value);
    caliTop = parseInt(document.getElementById('cali-top').value);
    caliHeight = parseInt(document.getElementById('cali-height').value);
    caliSkew = parseInt(document.getElementById('cali-skew').value);
    caliOptGap = parseFloat(document.getElementById('cali-opt-gap').value);
    caliThreshold = parseInt(document.getElementById('cali-threshold').value);
    
    document.getElementById('val-left').innerText = caliLeft;
    document.getElementById('val-width').innerText = caliWidth;
    document.getElementById('val-top').innerText = caliTop;
    document.getElementById('val-height').innerText = caliHeight;
    document.getElementById('val-skew').innerText = caliSkew;
    document.getElementById('val-opt-gap').innerText = caliOptGap;
    document.getElementById('val-threshold').innerText = caliThreshold;
    
    const totalQs = parseInt(document.getElementById('input-total-questions').value) || 20;
    
    // 重新繪製與更新正確答案
    if (cachedAnswerImg) {
        const canvas = document.getElementById('canvas-answer');
        baseAnswerKey = scanPaperAnswersProportional(cachedAnswerImg, offscreenAnswerCanvas, canvas, totalQs, true);
        isBaseAnswerReady = true;
        ansStatus.innerText = `✅ 已就緒 (${baseAnswerKey.filter(x => x !== null).length} 題)`;
        ansStatus.className = "badge badge-success";
    }
    
    // 重新批改學生答案卡
    if (cachedStudentImg && isBaseAnswerReady) {
        const canvas = document.getElementById('canvas-student');
        const studentAnswers = scanPaperAnswersProportional(cachedStudentImg, offscreenStudentCanvas, canvas, totalQs, false);
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
        
        document.querySelector('.drop-wrapper-ans').classList.add('hidden');
        const canvas = document.getElementById('canvas-answer');
        canvas.classList.remove('hidden');
        canvas.width = TARGET_WIDTH;
        canvas.height = TARGET_HEIGHT;
        
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
 * 🔍 核心優化：等比例包絡線分割演算法 + 傾斜剪切修正
 */
function scanPaperAnswersProportional(imgEl, offscreenCanvas, onscreenCanvas, totalQs, isBaseConfig = false) {
    const onscreenCtx = onscreenCanvas.getContext('2d');
    const offscreenCtx = offscreenCanvas.getContext('2d');
    
    // 重繪乾淨畫面
    onscreenCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    onscreenCtx.drawImage(imgEl, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    
    const options = ['A', 'B', 'C', 'D'];
    let paperAnswers = [];
    
    for (let q = 1; q <= totalQs; q++) {
        let colIdx = Math.floor((q - 1) / 25); // 0 ~ 3 大縱列
        let rowIdx = (q - 1) % 25;            // 0 ~ 24 排題目
        
        // 🌟 1. 核心改良：大縱列起點採用總寬度比例瓜分，徹底消除累積加法誤差
        let colXStart = caliLeft + colIdx * (caliWidth / 3);
        
        // 🌟 2. 核心改良：題目排高採用總高度比例瓜分
        let rowTopY = caliTop + rowIdx * (caliHeight / 24);
        
        // 🌟 3. 核心改良：加上紙張傾斜修正量 (隨著排數往下，線性遞增/遞減 X 軸偏移)
        let skewOffset = (rowIdx - 12) * (caliSkew / 10);
        let finalRowY = rowTopY;
        let finalColX = colXStart + skewOffset;
        
        let maxDarkPixels = 0;
        let detectedOptionIndex = -1;
        let optionPixelCounts = [];
        
        for (let o = 0; o < 4; o++) {
            // 計算 ABCD 選項的精準 X 軸坐標
            let optX = finalColX + GRID_CONSTANT.qNumberWidth + (o * caliOptGap);
            let optY = finalRowY;
            
            let safeX = Math.max(0, Math.min(optX, TARGET_WIDTH - GRID_CONSTANT.roiSize));
            let safeY = Math.max(0, Math.min(optY, TARGET_HEIGHT - GRID_CONSTANT.roiSize));
            
            // 從離線畫布讀取純淨像素，防彩色對齊框干擾
            let imgData = offscreenCtx.getImageData(safeX, safeY, GRID_CONSTANT.roiSize, GRID_CONSTANT.roiSize);
            let pixels = imgData.data;
            let darkPixelCount = 0;
            
            for (let i = 0; i < pixels.length; i += 4) {
                let r = pixels[i];
                let g = pixels[i+1];
                let b = pixels[i+2];
                let grayscale = 0.299 * r + 0.587 * g + 0.114 * b;
                
                if (grayscale < 135) { // 亮度低於 135 判定為塗黑點
                    darkPixelCount++;
                }
            }
            
            optionPixelCounts.push({ index: o, count: darkPixelCount, x: safeX, y: safeY });
            if (darkPixelCount > maxDarkPixels) {
                maxDarkPixels = darkPixelCount;
                detectedOptionIndex = o;
            }
            
            // 繪製琥珀色感應方塊
            onscreenCtx.strokeStyle = 'rgba(217, 119, 6, 0.25)'; 
            onscreenCtx.lineWidth = 1;
            onscreenCtx.strokeRect(safeX, safeY, GRID_CONSTANT.roiSize, GRID_CONSTANT.roiSize);
        }
        
        if (maxDarkPixels > caliThreshold) {
            paperAnswers.push(options[detectedOptionIndex]);
            let bestOpt = optionPixelCounts[detectedOptionIndex];
            onscreenCtx.strokeStyle = isBaseConfig ? '#10b981' : '#4f46e5'; 
            onscreenCtx.lineWidth = 2.5;
            onscreenCtx.strokeRect(bestOpt.x - 1, bestOpt.y - 1, GRID_CONSTANT.roiSize + 2, GRID_CONSTANT.roiSize + 2);
        } else {
            paperAnswers.push(null);
        }
    }
    
    return paperAnswers;
}

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

btnNextStudent.addEventListener('click', () => {
    uploadStudent.value = '';
    cachedStudentImg = null;
    const canvas = document.getElementById('canvas-student');
    canvas.classList.add('hidden');
    document.querySelector('.drop-wrapper').classList.remove('hidden');
    resultPanel.classList.add('hidden');
});

btnFullReset.addEventListener('click', () => {
    cachedAnswerImg = null;
    cachedStudentImg = null;
    location.reload(); 
});
