// ==========================================
// 1. 全域變數與幾何矩陣常數宣告
// ==========================================
let baseAnswerKey = []; 
let isBaseAnswerReady = false;

const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 1100;

// 瀚浩教育答案卡內部的黃金歸一化比例矩陣 (相對於大黑框的精準百分比)
const CARD_PROPORTIONS = {
    vStart: 0.02,       // 第一排題目相對於大外框頂端的 V 比例
    vStep: 0.04,        // 每排題目之間的垂直 V 跨距比例 (1 / 25)
    uColStarts: [0.0, 0.25, 0.50, 0.75], // 四個縱列區塊的 U 起點比例
    uOptStart: 0.055,   // 題號過後的 Option A 的水平起始偏移比例
    uOptStep: 0.050,    // A -> B -> C -> D 的水平跨距比例
    roiSize: 18          // 感應像素方塊大小 (18x18 像素)
};

// 4 角定位點坐標儲存器 (雙畫布獨立運作)
let answerCorners = { tl: {x:35, y:145}, tr: {x:765, y:145}, bl: {x:35, y:1055}, br: {x:765, y:1055} };
let studentCorners = { tl: {x:35, y:145}, tr: {x:765, y:145}, bl: {x:35, y:1055}, br: {x:765, y:1055} };

// 微調控制動態變數
let caliLeft = 35;
let caliWidth = 612;
let caliTop = 145;
let caliHeight = 910;
let caliOptGap = 35.5;
let caliThreshold = 45;

let dragTarget = null; // 追蹤鼠標/手指正在抓哪一個把手

// 離線快取畫布
let offscreenAnswerCanvas = document.createElement('canvas');
let offscreenStudentCanvas = document.createElement('canvas');
offscreenAnswerCanvas.width = TARGET_WIDTH; offscreenAnswerCanvas.height = TARGET_HEIGHT;
offscreenStudentCanvas.width = TARGET_WIDTH; offscreenStudentCanvas.height = TARGET_HEIGHT;

let cachedAnswerImg = null;
let cachedStudentImg = null;

// ==========================================
// 🌟 核心修復：所有 DOM 節點宣告完全與 HTML 對齊繫結
// ==========================================
const uploadAnswer = document.getElementById('upload-answer');
const uploadStudent = document.getElementById('upload-student');
const btnNextStudent = document.getElementById('btn-next-student');
const btnFullReset = document.getElementById('btn-full-reset');
const resultPanel = document.getElementById('result-panel');
const ansStatus = document.getElementById('ans-status');

// ==========================================
// 2. 監聽器與事件綁定
// ==========================================
const sliders = ['cali-left', 'cali-width', 'cali-top', 'cali-height', 'cali-opt-gap', 'cali-threshold'];
sliders.forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        readSlidersValues();
        rerenderAndAnalyzeAll();
    });
});
document.getElementById('input-total-questions').addEventListener('input', rerenderAndAnalyzeAll);

// 初始化雙畫布的手指/滑鼠解鎖機制
setupCanvasDragEvents('canvas-answer', answerCorners);
setupCanvasDragEvents('canvas-student', studentCorners);

function readSlidersValues() {
    caliLeft = parseInt(document.getElementById('cali-left').value);
    caliWidth = parseInt(document.getElementById('cali-width').value);
    caliTop = parseInt(document.getElementById('cali-top').value);
    caliHeight = parseInt(document.getElementById('cali-height').value);
    caliOptGap = parseFloat(document.getElementById('cali-opt-gap').value);
    caliThreshold = parseInt(document.getElementById('cali-threshold').value);
    
    document.getElementById('val-left').innerText = caliLeft;
    document.getElementById('val-width').innerText = caliWidth;
    document.getElementById('val-top').innerText = caliTop;
    document.getElementById('val-height').innerText = caliHeight;
    document.getElementById('val-opt-gap').innerText = caliOptGap;
    document.getElementById('val-threshold').innerText = caliThreshold;
}

/**
 * 工業級「結構化網格共振擬合演算法」
 */
function autoFitGridMatrix(offCtx) {
    const imgData = offCtx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    const pixels = imgData.data;
    
    let graySum = 0, count = 0;
    for (let y = 300; y < 800; y += 20) {
        for (let x = 200; x < 600; x += 20) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            graySum += (pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3;
            count++;
        }
    }
    let threshold = (graySum / count) * 0.75; 
    
    let vProj = new Array(TARGET_WIDTH).fill(0);
    let hProj = new Array(TARGET_HEIGHT).fill(0);
    for (let y = 140; y < 1060; y++) {
        for (let x = 20; x < 780; x++) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            if ((pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3 < threshold) {
                vProj[x]++;
                hProj[y]++;
            }
        }
    }
    
    let bestX0 = 35, bestW = 612, maxXScore = -1;
    for (let x0 = 25; x0 <= 75; x0 += 2) {
        for (let w = 590; w <= 650; w += 2) {
            let score = 0;
            let step = w / 4;
            for (let k = 0; k <= 4; k++) {
                let xVal = Math.round(x0 + k * step);
                if (xVal < TARGET_WIDTH) {
                    score += vProj[xVal] + (vProj[xVal-1]||0) + (vProj[xVal+1]||0);
                }
            }
            if (score > maxXScore) { maxXScore = score; bestX0 = x0; bestW = w; }
        }
    }
    
    let bestY0 = 195, bestH = 835, maxYScore = -1;
    for (let y0 = 150; y0 <= 230; y0 += 2) {
        for (let h = 800; h <= 860; h += 2) {
            let score = 0;
            let step = h / 24; 
            for (let r = 0; r <= 24; r++) {
                let yVal = Math.round(y0 + r * step);
                if (yVal < TARGET_HEIGHT) {
                    score += hProj[yVal] + (hProj[yVal-1]||0) + (hProj[yVal+1]||0);
                }
            }
            if (score > maxYScore) { maxYScore = score; bestY0 = y0; bestH = h; }
        }
    }
    
    let outerTop = bestY0 - 50;
    let outerHeight = bestH + 70;
    
    return {
        tl: { x: bestX0, y: outerTop },
        tr: { x: bestX0 + bestW, y: outerTop },
        bl: { x: bestX0, y: outerTop + outerHeight },
        br: { x: bestX0 + bestW, y: outerTop + outerHeight }
    };
}

/**
 * 雙線性扭曲幾何投影
 */
function getBilinearPoint(u, v, corners) {
    let x = (1 - u) * (1 - v) * corners.tl.x + u * (1 - v) * corners.tr.x + (1 - u) * v * corners.bl.x + u * v * corners.br.x;
    let y = (1 - u) * (1 - v) * corners.tl.y + u * (1 - v) * corners.tr.y + (1 - u) * v * corners.bl.y + u * v * corners.br.y;
    return { x: x, y: y };
}

function rerenderAndAnalyzeAll() {
    const totalQs = parseInt(document.getElementById('input-total-questions').value) || 20;
    
    if (cachedAnswerImg) {
        baseAnswerKey = executeRenderAndOMR(cachedAnswerImg, offscreenAnswerCanvas, 'canvas-answer', totalQs, answerCorners, true);
        isBaseAnswerReady = true;
        ansStatus.innerText = `✅ 已就緒 (${baseAnswerKey.filter(x => x !== null).length} 題)`;
        ansStatus.className = "badge badge-success";
    }
    
    if (cachedStudentImg && isBaseAnswerReady) {
        const studentAnswers = executeRenderAndOMR(cachedStudentImg, offscreenStudentCanvas, 'canvas-student', totalQs, studentCorners, false);
        gradeStudentCard(studentAnswers, totalQs);
    }
}

/**
 * 🔍 核心掃描與分析
 */
function executeRenderAndOMR(imgEl, offscreenCanvas, onscreenCanvasId, totalQs, corners, isBaseConfig = false) {
    const canvas = document.getElementById(onscreenCanvasId);
    const onscreenCtx = canvas.getContext('2d');
    const offscreenCtx = offscreenCanvas.getContext('2d');
    
    onscreenCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    onscreenCtx.drawImage(imgEl, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    
    const sample = offscreenCtx.getImageData(TARGET_WIDTH/4, TARGET_HEIGHT/4, TARGET_WIDTH/2, TARGET_HEIGHT/2).data;
    let sSum = 0; for(let i=0; i<sample.length; i+=16) sSum += (sample[i]+sample[i+1]+sample[i+2])/3;
    let dynamicThresh = (sSum / (sample.length / 16)) * 0.74;

    const options = ['A', 'B', 'C', 'D'];
    let paperAnswers = [];
    
    for (let q = 1; q <= totalQs; q++) {
        let colIdx = Math.floor((q - 1) / 25);
        let rowIdx = (q - 1) % 25;
        
        let v = CARD_PROPORTIONS.vStart + (rowIdx * CARD_PROPORTIONS.vStep);
        let colUStart = CARD_PROPORTIONS.uColStarts[colIdx];
        
        let maxDarkPixels = 0;
        let detectedOptionIndex = -1;
        let optionPixelCounts = [];
        
        for (let o = 0; o < 4; o++) {
            let u = colUStart + CARD_PROPORTIONS.uOptStart + (o * CARD_PROPORTIONS.uOptStep);
            let pt = getBilinearPoint(u, v, corners);
            
            let safeX = Math.max(0, Math.min(pt.x - CARD_PROPORTIONS.roiSize/2, TARGET_WIDTH - CARD_PROPORTIONS.roiSize));
            let safeY = Math.max(0, Math.min(pt.y - CARD_PROPORTIONS.roiSize/2, TARGET_HEIGHT - CARD_PROPORTIONS.roiSize));
            
            let imgData = offscreenCtx.getImageData(safeX, safeY, CARD_PROPORTIONS.roiSize, CARD_PROPORTIONS.roiSize);
            let pixels = imgData.data;
            let darkCount = 0;
            
            for (let i = 0; i < pixels.length; i += 4) {
                if ((pixels[i] + pixels[i+1] + pixels[i+2]) / 3 < dynamicThresh) darkCount++;
            }
            
            optionPixelCounts.push({ index: o, count: darkCount, x: safeX, y: safeY });
            if (darkCount > maxDarkPixels) { maxDarkPixels = darkCount; detectedOptionIndex = o; }
            
            onscreenCtx.strokeStyle = 'rgba(245, 158, 11, 0.25)'; 
            onscreenCtx.lineWidth = 1;
            onscreenCtx.strokeRect(safeX, safeY, CARD_PROPORTIONS.roiSize, CARD_PROPORTIONS.roiSize);
        }
        
        if (maxDarkPixels > caliThreshold) {
            paperAnswers.push(options[detectedOptionIndex]);
            let best = optionPixelCounts[detectedOptionIndex];
            onscreenCtx.strokeStyle = isBaseConfig ? '#10b981' : '#4f46e5'; 
            onscreenCtx.lineWidth = 2.5;
            onscreenCtx.strokeRect(best.x - 1, best.y - 1, CARD_PROPORTIONS.roiSize + 2, CARD_PROPORTIONS.roiSize + 2);
        } else {
            paperAnswers.push(null);
        }
    }
    
    // 繪製圓形把手
    const handleColor = isBaseConfig ? '#10b981' : '#4f46e5';
    for (let key in corners) {
        onscreenCtx.fillStyle = handleColor;
        onscreenCtx.strokeStyle = '#ffffff';
        onscreenCtx.lineWidth = 2;
        onscreenCtx.beginPath();
        onscreenCtx.arc(corners[key].x, corners[key].y, 11, 0, 2 * Math.PI);
        onscreenCtx.fill();
        onscreenCtx.stroke();
    }
    
    return paperAnswers;
}

// ==========================================
// 3. 檔案上傳事件控制
// ==========================================
uploadAnswer.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const img = new Image();
    img.onload = function() {
        cachedAnswerImg = img;
        document.querySelector('.drop-wrapper-ans').classList.add('hidden');
        const canvas = document.getElementById('canvas-answer');
        canvas.classList.remove('hidden');
        canvas.width = TARGET_WIDTH; canvas.height = TARGET_HEIGHT;
        
        const offCtx = offscreenAnswerCanvas.getContext('2d');
        offCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        offCtx.drawImage(img, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        
        answerCorners = autoFitGridMatrix(offCtx);
        
        // 將自動識別出的位置同步填回滑桿
        document.getElementById('cali-left').value = answerCorners.tl.x;
        document.getElementById('cali-width').value = answerCorners.tr.x - answerCorners.tl.x;
        document.getElementById('cali-top').value = answerCorners.tl.y;
        document.getElementById('cali-height').value = answerCorners.bl.y - answerCorners.tl.y;
        
        readSlidersValues();
        rerenderAndAnalyzeAll();
    };
    img.src = URL.createObjectURL(file);
});

uploadStudent.addEventListener('change', (e) => {
    if (!isBaseAnswerReady) { alert('請先在右側設定「正確答案卡」基準！'); uploadStudent.value = ''; return; }
    const file = e.target.files[0]; if (!file) return;
    const img = new Image();
    img.onload = function() {
        cachedStudentImg = img;
        document.querySelector('.drop-wrapper').classList.add('hidden');
        const canvas = document.getElementById('canvas-student');
        canvas.classList.remove('hidden');
        canvas.width = TARGET_WIDTH; canvas.height = TARGET_HEIGHT;
        
        const offCtx = offscreenStudentCanvas.getContext('2d');
        offCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        offCtx.drawImage(img, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        
        studentCorners = autoFitGridMatrix(offCtx);
        rerenderAndAnalyzeAll();
    };
    img.src = URL.createObjectURL(file);
});

// ==========================================
// 4. 智慧互動手感控制模組
// ==========================================
function setupCanvasDragEvents(canvasId, cornersObj) {
    const canvas = document.getElementById(canvasId);
    
    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        let clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (TARGET_WIDTH / rect.width),
            y: (clientY - rect.top) * (TARGET_HEIGHT / rect.height)
        };
    }
    
    function handleStart(e) {
        if ((canvasId === 'canvas-answer' && !cachedAnswerImg) || (canvasId === 'canvas-student' && !cachedStudentImg)) return;
        const pos = getMousePos(e);
        for (let key in cornersObj) {
            let dx = pos.x - cornersObj[key].x;
            let dy = pos.y - cornersObj[key].y;
            if (Math.sqrt(dx*dx + dy*dy) < 24) { 
                dragTarget = { canvasId: canvasId, key: key };
                e.preventDefault(); break;
            }
        }
    }
    
    function handleMove(e) {
        if (!dragTarget || dragTarget.canvasId !== canvasId) return;
        const pos = getMousePos(e);
        cornersObj[dragTarget.key].x = Math.max(0, Math.min(pos.x, TARGET_WIDTH));
        cornersObj[dragTarget.key].y = Math.max(0, Math.min(pos.y, TARGET_HEIGHT));
        e.preventDefault();
        rerenderAndAnalyzeAll(); 
    }
    
    function handleEnd() { dragTarget = null; }
    
    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
}

function gradeStudentCard(studentAnswers, totalQs) {
    const scorePerQ = parseFloat(document.getElementById('input-score-per-question').value) || 5;
    const wrongList = document.getElementById('wrong-list');
    wrongList.innerHTML = '';
    let wrongCount = 0; let correctCount = 0;

    for (let i = 0; i < totalQs; i++) {
        const studentAns = studentAnswers[i] || '未劃記'; 
        const correctAns = baseAnswerKey[i];
        if (studentAns === correctAns) {
            correctCount++;
        } else {
            wrongCount++;
            const li = document.createElement('li');
            li.innerHTML = `<span>第 <strong>${i+1}</strong> 題</span> <span>正確 [${correctAns || '空'}] ➔ 讀到 [${studentAns}]</span>`;
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
    uploadStudent.value = ''; cachedStudentImg = null;
    const canvas = document.getElementById('canvas-student');
    canvas.classList.add('hidden');
    document.querySelector('.drop-wrapper').classList.remove('hidden');
    resultPanel.classList.add('hidden');
});

btnFullReset.addEventListener('click', () => {
    cachedAnswerImg = null; cachedStudentImg = null; location.reload(); 
});

// 初始化滑桿預設數值
readSlidersValues();
