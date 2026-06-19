// 全域狀態管理
let baseAnswerKey = []; 
let isBaseAnswerReady = false;

// 物理幾何目標標準尺寸（強制映射解析度系）
const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 1100;

const GRID_CONSTANT = {
    qNumberWidth: 32,  // 題號區塊寬度
    roiSize: 18        // 偵測氣泡方塊大小 (18x18 像素)
};

// UI 控制項動態變數 (解答本基準)
let caliLeft = 50;
let caliWidth = 600;
let caliTop = 190;
let caliHeight = 830;
let caliSkew = 0;
let caliOptGap = 35.5;
let caliThreshold = 45;

// 離線快取畫布（防污損像素讀取核心）
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

// 綁定控制滑桿連動
const sliders = ['cali-left', 'cali-width', 'cali-top', 'cali-height', 'cali-skew', 'cali-opt-gap', 'cali-threshold'];
sliders.forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        readSlidersValues();
        rerenderGrids();
    });
});
document.getElementById('input-total-questions').addEventListener('input', rerenderGrids);

function readSlidersValues() {
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
}

/**
 * 🛠️ 核心突破：直方圖黑框邊界自動偵測演算法 (掃描印刷黑色外大矩形)
 */
function autoDetectCardBounds(offCtx) {
    const imgData = offCtx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    const pixels = imgData.data;
    
    // 1. 動態背景採樣：採集中央大範圍紙張亮度，算出最完美的黑白分明臨界值
    let graySum = 0, sampleCount = 0;
    for (let y = 300; y < 800; y += 25) {
        for (let x = 200; x < 600; x += 25) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            graySum += (pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3;
            sampleCount++;
        }
    }
    let avgPageBrightness = graySum / sampleCount;
    let thresh = avgPageBrightness * 0.72; // 低於此亮度判定為印刷墨水黑線
    
    // 2. 垂直投影直方圖 (尋找左與右垂直邊框線)
    let vProj = new Array(TARGET_WIDTH).fill(0);
    for (let x = 10; x < TARGET_WIDTH - 10; x++) {
        for (let y = 250; y < 950; y++) { // 鎖定中段題目區
            let idx = (y * TARGET_WIDTH + x) * 4;
            if ((pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3 < thresh) vProj[x]++;
        }
    }
    
    let detectLeft = 35;
    let maxL = 0;
    for (let x = 20; x < 160; x++) {
        if (vProj[x] > maxL) { maxL = vProj[x]; detectLeft = x; }
    }
    
    let detectRight = 765;
    let maxR = 0;
    for (let x = 640; x < 780; x++) {
        if (vProj[x] > maxR) { maxR = vProj[x]; detectRight = x; }
    }
    
    // 3. 水平投影直方圖 (尋找頂與底水平邊框線)
    let hProj = new Array(TARGET_HEIGHT).fill(0);
    for (let y = 100; y < TARGET_HEIGHT - 30; y++) {
        for (let x = detectLeft; x <= detectRight; x++) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            if ((pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3 < thresh) hProj[y]++;
        }
    }
    
    let detectTop = 195;
    let maxT = 0;
    for (let y = 140; y < 280; y++) {
        if (hProj[y] > maxT) { maxT = hProj[y]; detectTop = y; }
    }
    
    let detectBottom = 1025;
    let maxB = 0;
    for (let y = 920; y < 1060; y++) {
        if (hProj[y] > maxB) { maxB = hProj[y]; detectBottom = y; }
    }
    
    let detectWidth = detectRight - detectLeft;
    let detectHeight = detectBottom - detectTop;
    
    // 安全防錯保護 (若拍照極度極端時提供基礎防线)
    if (detectWidth < 450 || detectWidth > 750) detectWidth = 612;
    if (detectHeight < 650 || detectHeight > 980) detectHeight = 835;
    if (detectLeft < 15 || detectLeft > 180) detectLeft = 35;
    if (detectTop < 120 || detectTop > 320) detectTop = 195;
    
    return { left: detectLeft, width: detectWidth, top: detectTop, height: detectHeight };
}

/**
 * 🔄 連動刷新引擎
 */
function rerenderGrids() {
    const totalQs = parseInt(document.getElementById('input-total-questions').value) || 20;
    
    if (cachedAnswerImg) {
        const canvas = document.getElementById('canvas-answer');
        const bounds = { left: caliLeft, width: caliWidth, top: caliTop, height: caliHeight };
        baseAnswerKey = scanAndRenderCore(cachedAnswerImg, offscreenAnswerCanvas, canvas, totalQs, bounds, caliSkew, true);
        isBaseAnswerReady = true;
        ansStatus.innerText = `✅ 已就緒 (${baseAnswerKey.filter(x => x !== null).length} 題)`;
        ansStatus.className = "badge badge-success";
    }
    
    if (cachedStudentImg && isBaseAnswerReady) {
        const canvas = document.getElementById('canvas-student');
        // 🔥 核心優化：學生卡在上傳時已獨立偵測完邊界，批改時直接套用該獨立快取 bounds，不干涉解答本
        const studentAnswers = scanAndRenderCore(cachedStudentImg, offscreenStudentCanvas, canvas, totalQs, studentDetectedBounds, studentDetectedSkew, false);
        gradeStudentCard(studentAnswers, totalQs);
    }
}

// 記憶學生卡專用的獨立偵測邊界矩陣
let studentDetectedBounds = { left: 35, width: 612, top: 195, height: 835 };
let studentDetectedSkew = 0;

// 上傳正確答案卡
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
        
        // 🚀 執行全自動邊緣識別
        let autoBounds = autoDetectCardBounds(offCtx);
        
        // 將識別結果寫回 UI 滑桿，方便視覺化核對
        document.getElementById('cali-left').value = autoBounds.left;
        document.getElementById('cali-width').value = autoBounds.width;
        document.getElementById('cali-top').value = autoBounds.top;
        document.getElementById('cali-height').value = autoBounds.height;
        document.getElementById('cali-skew').value = 0;
        
        readSlidersValues();
        rerenderGrids();
    };
    img.src = URL.createObjectURL(file);
});

// 上傳學生卡
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
        
        // 🚀 核心優化：為這張學生卡獨立執行直方圖框邊界掃描 (實現全自動自適應對齊)
        studentDetectedBounds = autoDetectCardBounds(offCtx);
        // 承襲目前的微調斜角常數作為輔助平衡
        studentDetectedSkew = caliSkew; 
        
        rerenderGrids();
    };
    img.src = URL.createObjectURL(file);
});

/**
 * 🔍 網格分割與氣泡像素相對量最大化比對運算
 */
function scanAndRenderCore(imgEl, offscreenCanvas, onscreenCanvas, totalQs, bounds, skew, isBaseConfig = false) {
    const onscreenCtx = onscreenCanvas.getContext('2d');
    const offscreenCtx = offscreenCanvas.getContext('2d');
    
    onscreenCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    onscreenCtx.drawImage(imgEl, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    
    // 精準動態二值化採樣
    const sampleData = offscreenCtx.getImageData(bounds.left + 50, bounds.top + 50, bounds.width - 100, bounds.height - 100);
    const sPixels = sampleData.data;
    let sSum = 0;
    for(let i=0; i<sPixels.length; i+=16) { sSum += (sPixels[i]+sPixels[i+1]+sPixels[i+2])/3; }
    let dynamicThresh = (sSum / (sPixels.length / 16)) * 0.75;

    const options = ['A', 'B', 'C', 'D'];
    let paperAnswers = [];
    
    // 計算彈簧等比例跨距
    let colBlockWidth = GRID_CONSTANT.qNumberWidth + (3 * caliOptGap);
    let colStep = (bounds.width - colBlockWidth) / 3;
    let rowStep = (bounds.height - GRID_CONSTANT.roiSize) / 24;
    
    for (let q = 1; q <= totalQs; q++) {
        let colIdx = Math.floor((q - 1) / 25);
        let rowIdx = (q - 1) % 25;
        
        let colXStart = bounds.left + colIdx * colStep;
        let rowTopY = bounds.top + rowIdx * rowStep;
        
        // 斜角幾何修正
        let skewOffset = (rowIdx - 12) * (skew / 10);
        let finalColX = colXStart + skewOffset;
        
        let maxDarkPixels = 0;
        let detectedOptionIndex = -1;
        let optionPixelCounts = [];
        
        for (let o = 0; o < 4; o++) {
            let optX = finalColX + GRID_CONSTANT.qNumberWidth + (o * caliOptGap);
            let safeX = Math.max(0, Math.min(optX, TARGET_WIDTH - GRID_CONSTANT.roiSize));
            let safeY = Math.max(0, Math.min(rowTopY, TARGET_HEIGHT - GRID_CONSTANT.roiSize));
            
            let imgData = offscreenCtx.getImageData(safeX, safeY, GRID_CONSTANT.roiSize, GRID_CONSTANT.roiSize);
            let pixels = imgData.data;
            let darkPixelCount = 0;
            
            for (let i = 0; i < pixels.length; i += 4) {
                if ((pixels[i] + pixels[i+1] + pixels[i+2]) / 3 < dynamicThresh) {
                    darkPixelCount++;
                }
            }
            
            optionPixelCounts.push({ index: o, count: darkPixelCount, x: safeX, y: safeY });
            if (darkPixelCount > maxDarkPixels) {
                maxDarkPixels = darkPixelCount;
                detectedOptionIndex = o;
            }
            
            // 繪製定位小方框
            onscreenCtx.strokeStyle = 'rgba(217, 119, 6, 0.25)'; 
            onscreenCtx.lineWidth = 1;
            onscreenCtx.strokeRect(safeX, safeY, GRID_CONSTANT.roiSize, GRID_CONSTANT.roiSize);
        }
        
        // 門檻過濾
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

// 初始化滑桿文字數值顯示
readSlidersValues();
