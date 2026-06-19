// 全域基礎網格參數定義
let baseAnswerKey = []; 
let isBaseAnswerReady = false;

const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 1100;

// 瀚浩教育答案卡標準物理幾何常數
const GRID = {
    colStarts: [35, 223, 411, 599], // 四大縱列基準起點
    qNumberWidth: 32,              // 題號字元寬度
    roiSize: 18                    // 觀測感應方塊大小 (18x18 像素)
};

// 🛠️ 動態校準控制變數
let caliX = 0;
let caliY = 0;
let caliOptGap = 38;
let caliRowHeight = 34.6;
let caliThreshold = 80;

const GRID_START_Y_BASE = 195; // 縱列第1題垂直高度理論起點

// 🗄️ 影像高速快取矩陣 (防拉動滑桿時重複編譯，節省大量運算，防止記憶體外洩)
let cachedAnswerWarped = null;
let cachedStudentWarped = null;

// DOM 元素繫結
const uploadAnswer = document.getElementById('upload-answer');
const uploadStudent = document.getElementById('upload-student');
const btnNextStudent = document.getElementById('btn-next-student');
const btnFullReset = document.getElementById('btn-full-reset');
const resultPanel = document.getElementById('result-panel');
const ansStatus = document.getElementById('ans-status');
const loadingOverlay = document.getElementById('opencv-loading-overlay');

// 🔥 核心修復：由全域對接 window.Module 的執行緒就緒訊號
window.initMyOMRSystem = function() {
    console.log("OpenCV.js 智慧校準核心全面解鎖！");
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none'; // 2026年生產版核心解鎖，隱藏轉圈圈
    }
};

// 綁定所有校準滑桿
const sliders = ['cali-x', 'cali-y', 'cali-opt-gap', 'cali-row-height', 'cali-threshold'];
sliders.forEach(id => {
    document.getElementById(id).addEventListener('input', updateCalibrationAndRerender);
});
document.getElementById('input-total-questions').addEventListener('input', updateCalibrationAndRerender);

/**
 * 核心即時連動引擎：免重新上傳，拉動任何滑桿瞬間更新畫布網格與閱卷分數
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
    
    // 重新校準標準答案卡
    if (cachedAnswerWarped) {
        baseAnswerKey = scanPaperAnswers(cachedAnswerWarped, totalQs, document.getElementById('canvas-answer'), true);
        isBaseAnswerReady = true;
        ansStatus.innerText = `✅ 已就緒 (${baseAnswerKey.filter(x => x !== null).length} 題)`;
        ansStatus.className = "badge badge-success";
    }
    
    // 重新校準並批改學生卡
    if (cachedStudentWarped && isBaseAnswerReady) {
        const studentAnswers = scanPaperAnswers(cachedStudentWarped, totalQs, document.getElementById('canvas-student'), false);
        gradeStudentCard(studentAnswers, totalQs);
    }
}

// 處理正確答案卡上傳
uploadAnswer.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const img = new Image();
    img.onload = function() {
        const canvas = document.getElementById('canvas-answer');
        const label = document.querySelector('.drop-wrapper-ans');
        const src = cv.imread(img);
        
        if (cachedAnswerWarped) cachedAnswerWarped.delete();
        cachedAnswerWarped = processAndWarpCardRobust(src);
        src.delete();
        
        label.classList.add('hidden'); // 隱藏上傳虛線大框
        canvas.classList.remove('hidden'); // 開啟影像畫布
        
        updateCalibrationAndRerender();
    };
    img.src = URL.createObjectURL(file);
});

// 處理學生答案卡上傳
uploadStudent.addEventListener('change', (e) => {
    if (!isBaseAnswerReady) {
        alert('請先在右側上傳並設定「正確答案卡」基準！');
        uploadStudent.value = '';
        return;
    }
    
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = function() {
        const canvas = document.getElementById('canvas-student');
        const label = document.querySelector('.drop-wrapper');
        const src = cv.imread(img);
        
        if (cachedStudentWarped) cachedStudentWarped.delete();
        cachedStudentWarped = processAndWarpCardRobust(src);
        src.delete();
        
        label.classList.add('hidden');
        canvas.classList.remove('hidden');
        
        updateCalibrationAndRerender();
    };
    img.src = URL.createObjectURL(file);
});

/**
 * 電腦視覺極端點去背拉正演算法 (Extreme Points Wrap Perspective)
 */
function processAndWarpCardRobust(src) {
    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let thresh = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 0);
    cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 51, 11);
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    
    let maxArea = 0;
    let maxContourIdx = -1;
    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        if (area > maxArea) { maxArea = area; maxContourIdx = i; }
    }
    
    let dst = new cv.Mat();
    let dsize = new cv.Size(TARGET_WIDTH, TARGET_HEIGHT);
    
    if (maxContourIdx !== -1) {
        let largestContour = contours.get(maxContourIdx);
        let minSum = 999999, maxSum = -999999, minDiff = 999999, maxDiff = -999999;
        let tl, tr, br, bl;
        
        for (let j = 0; j < largestContour.rows; j++) {
            let x = largestContour.data32S[j * 2];
            let y = largestContour.data32S[j * 2 + 1];
            if (x + y < minSum) { minSum = x + y; tl = {x, y}; }
            if (x + y > maxSum) { maxSum = x + y; br = {x, y}; }
            if (y - x < minDiff) { minDiff = y - x; tr = {x, y}; }
            if (y - x > maxDiff) { maxDiff = y - x; bl = {x, y}; }
        }
        
        let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
        let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, TARGET_WIDTH, 0, TARGET_WIDTH, TARGET_HEIGHT, 0, TARGET_HEIGHT]);
        let M = cv.getPerspectiveTransform(srcTri, dstTri);
        cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
        
        srcTri.delete(); dstTri.delete(); M.delete();
    } else {
        cv.resize(src, dst, dsize, 0, 0, cv.INTER_LINEAR);
    }
    
    gray.delete(); blurred.delete(); thresh.delete(); contours.delete(); hierarchy.delete();
    return dst;
}

/**
 * 網格氣泡動態掃描 + HTML5 Canvas 即時高亮繪製
 */
function scanPaperAnswers(warpedMat, totalQs, canvas, isBaseConfig = false) {
    if (!warpedMat) return [];
    cv.imshow(canvas, warpedMat); // 每次刷新前重製畫布為乾淨原圖
    
    let gray = new cv.Mat();
    let thresh = new cv.Mat();
    cv.cvtColor(warpedMat, gray, cv.COLOR_RGBA2GRAY);
    cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    
    const options = ['A', 'B', 'C', 'D'];
    let paperAnswers = [];
    const ctx = canvas.getContext('2d');
    
    for (let q = 1; q <= totalQs; q++) {
        let colIdx = Math.floor((q - 1) / 25);
        let rowIdx = (q - 1) % 25;
        
        // 匯入微調偏移量
        let colXStart = GRID.colStarts[colIdx] + caliX;
        let rowTopY = GRID_START_Y_BASE + (rowIdx * caliRowHeight) + caliY;
        let optY = rowTopY + (caliRowHeight - GRID.roiSize) / 2;
        
        let maxPixels = 0;
        let detectedOptionIndex = -1;
        let optionPixelCounts = [];
        
        for (let o = 0; o < 4; o++) {
            let optX = colXStart + GRID.qNumberWidth + (o * caliOptGap) + (caliOptGap - GRID.roiSize) / 2;
            let safeX = Math.max(0, Math.min(optX, TARGET_WIDTH - GRID.roiSize));
            let safeY = Math.max(0, Math.min(optY, TARGET_HEIGHT - GRID.roiSize));
            
            let roiRect = new cv.Rect(safeX, safeY, GRID.roiSize, GRID.roiSize);
            let roi = thresh.roi(roiRect);
            let pixelCount = cv.countNonZero(roi);
            
            optionPixelCounts.push({ index: o, pixels: pixelCount, x: safeX, y: safeY });
            if (pixelCount > maxPixels) { maxPixels = pixelCount; detectedOptionIndex = o; }
            roi.delete();
            
            // 繪製微型感應琥珀色方塊，回饋當前偵測範圍
            ctx.strokeStyle = 'rgba(217, 119, 6, 0.25)'; 
            ctx.lineWidth = 1;
            ctx.strokeRect(safeX, safeY, GRID.roiSize, GRID.roiSize);
        }
        
        // 判定為劃記的深度閥值
        if (maxPixels > caliThreshold) {
            paperAnswers.push(options[detectedOptionIndex]);
            let bestOpt = optionPixelCounts[detectedOptionIndex];
            ctx.strokeStyle = isBaseConfig ? '#10b981' : '#4f46e5'; // 答案卡綠色，學生卡深藍
            ctx.lineWidth = 2.5;
            ctx.strokeRect(bestOpt.x - 1, bestOpt.y - 1, GRID.roiSize + 2, GRID.roiSize + 2);
        } else {
            paperAnswers.push(null); // 空白
        }
    }
    
    gray.delete(); thresh.delete();
    return paperAnswers;
}

/**
 * 結算成績與渲染錯題卡
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
            li.innerHTML = `<span>第 <strong>${i+1}</strong> 題</span> <span>應為 [${correctAns || '未設'}] ➔ 讀到 [${studentAns}]</span>`;
            wrongList.appendChild(li);
        }
    }

    let finalScore = correctCount * scorePerQ;
    if (finalScore > 100) finalScore = 100;

    document.getElementById('score-text').innerText = finalScore;
    document.getElementById('wrong-count').innerText = `${wrongCount} 題`;
    resultPanel.classList.remove('hidden');
}

// 換下一張學生卡 (清除左側，維持右側校準數據)
btnNextStudent.addEventListener('click', () => {
    uploadStudent.value = '';
    if (cachedStudentWarped) { cachedStudentWarped.delete(); cachedStudentWarped = null; }
    
    const canvas = document.getElementById('canvas-student');
    canvas.classList.add('hidden');
    document.querySelector('.drop-wrapper').classList.remove('hidden');
    resultPanel.classList.add('hidden');
});

// 完全重設 (釋放記憶體並重整網頁)
btnFullReset.addEventListener('click', () => {
    if (cachedAnswerWarped) cachedAnswerWarped.delete();
    if (cachedStudentWarped) cachedStudentWarped.delete();
    location.reload(); 
});