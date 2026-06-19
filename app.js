// 全域狀態管理
let baseAnswerKey = []; 
let isBaseAnswerReady = false;

const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 1100;

// 瀚浩教育答案卡網格物理佔比常數 (核心比例矩陣)
const CARD_PROPORTIONS = {
    vStart: 0.146,       // 第一排題目相對於大外框的 Y 比例
    vEnd: 0.965,         // 最後一排題目相對於大外框的 Y 比例
    uColStarts: [0.024, 0.270, 0.516, 0.762], // 四個直列區塊的 X 起點比例
    uNumWidth: 0.038,    // 題號區塊所佔寬度比例
    uOptGap: 0.044,      // OptionA -> B -> C -> D 的水平間距比例
    roiSize: 18          // 感應像素方塊大小 (18x18)
};

// 4 角定位點坐標儲存器 (解答卡與學生卡各自獨立)
let answerCorners = { tl: {x:35, y:145}, tr: {x:765, y:145}, bl: {x:35, y:1055}, br: {x:765, y:1055} };
let studentCorners = { tl: {x:35, y:145}, tr: {x:765, y:145}, bl: {x:35, y:1055}, br: {x:765, y:1055} };

let caliThreshold = 45;

// 離線畫布
let offscreenAnswerCanvas = document.createElement('canvas');
let offscreenStudentCanvas = document.createElement('canvas');
offscreenAnswerCanvas.width = TARGET_WIDTH;
offscreenAnswerCanvas.height = TARGET_HEIGHT;
offscreenStudentCanvas.width = TARGET_WIDTH;
offscreenStudentCanvas.height = TARGET_HEIGHT;

let cachedAnswerImg = null;
let cachedStudentImg = null;

// 拖曳狀態追蹤鎖
let dragTarget = null; // { canvasId: 'canvas-answer'/'canvas-student', key: 'tl'/'tr'/'bl'/'br' }

// DOM 元素選取
const uploadAnswer = document.getElementById('upload-answer');
const uploadStudent = document.getElementById('upload-student');
const btnNextStudent = document.getElementById('btn-next-student');
const btnFullReset = document.getElementById('btn-full-reset');
const resultPanel = document.getElementById('result-panel');
const ansStatus = document.getElementById('ans-status');

// 綁定靈敏度滑桿
document.getElementById('cali-threshold').addEventListener('input', (e) => {
    caliThreshold = parseInt(e.target.value);
    document.getElementById('val-threshold').innerText = caliThreshold;
    rerenderAndAnalyzeAll();
});
document.getElementById('input-total-questions').addEventListener('input', rerenderAndAnalyzeAll);

// 初始化畫布事件監聽（解鎖滑訊與觸控拖曳）
setupCanvasDragEvents('canvas-answer', answerCorners);
setupCanvasDragEvents('canvas-student', studentCorners);

/**
 * 🛠️ 核心演算法：自適應直方圖內縮黑框獵取器 (自動抓取印刷黑色大外框)
 */
function autoDetectFrame(offCtx) {
    const imgData = offCtx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    const pixels = imgData.data;
    
    // 1. 動態紙張亮度採樣，計算完美的二值化臨界值
    let graySum = 0, count = 0;
    for (let y = 400; y < 800; y += 30) {
        for (let x = 200; x < 600; x += 30) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            graySum += (pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3;
            count++;
        }
    }
    let threshold = (graySum / count) * 0.74; // 低於此亮度即視為黑色線條
    
    // 2. 四向內縮式切線探針（避開外部動漫桌墊等雜訊干擾）
    let L = 35, R = 765, T = 145, B = 1055;
    
    // 掃描左邊界 (從 X=25 內縮至 X=150)
    let hitsL = [];
    for (let y of [350, 550, 750]) {
        for (let x = 25; x < 150; x++) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            if ((pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3 < threshold) { hitsL.push(x); break; }
        }
    }
    if (hitsL.length > 0) L = hitsL.sort((a,b)=>a-b)[Math.floor(hitsL.length/2)];

    // 掃描右邊界 (從 X=775 外縮至 X=650)
    let hitsR = [];
    for (let y of [350, 550, 750]) {
        for (let x = 775; x > 650; x--) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            if ((pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3 < threshold) { hitsR.push(x); break; }
        }
    }
    if (hitsR.length > 0) R = hitsR.sort((a,b)=>a-b)[Math.floor(hitsR.length/2)];

    // 掃描頂邊界
    let hitsT = [];
    for (let x of [300, 400, 500]) {
        for (let y = 100; y < 250; y++) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            if ((pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3 < threshold) { hitsT.push(y); break; }
        }
    }
    if (hitsT.length > 0) T = hitsT.sort((a,b)=>a-b)[Math.floor(hitsT.length/2)];

    // 掃描底邊界
    let hitsB = [];
    for (let x of [300, 400, 500]) {
        for (let y = 1080; y > 900; y--) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            if ((pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3 < threshold) { hitsB.push(y); break; }
        }
    }
    if (hitsB.length > 0) B = hitsB.sort((a,b)=>a-b)[Math.floor(hitsB.length/2)];

    // 門檻防錯限幅保護
    if (R - L < 400 || B - T < 600) { L = 35; R = 765; T = 145; B = 1055; }

    return {
        tl: { x: L, y: T },
        tr: { x: R, y: T },
        bl: { x: L, y: B },
        br: { x: R, y: B }
    };
}

/**
 * ⚡ 核心數學：雙線性插值（Bilinear Interpolation）坐標映射器
 * 完美解決旋轉、縮放、上大下小等所有複雜變形！
 */
function getInterpolatedPoint(u, v, corners) {
    let x = (1 - u) * (1 - v) * corners.tl.x + u * (1 - v) * corners.tr.x + (1 - u) * v * corners.bl.x + u * v * corners.br.x;
    let y = (1 - u) * (1 - v) * corners.tl.y + u * (1 - v) * corners.tr.y + (1 - u) * v * corners.bl.y + u * v * corners.br.y;
    return { x: x, y: y };
}

function rerenderAndAnalyzeAll() {
    const totalQs = parseInt(document.getElementById('input-total-questions').value) || 20;
    
    if (cachedAnswerImg) {
        baseAnswerKey = processGridMapping(cachedAnswerImg, offscreenAnswerCanvas, 'canvas-answer', totalQs, answerCorners, true);
        isBaseAnswerReady = true;
        ansStatus.innerText = `✅ 已就緒 (${baseAnswerKey.filter(x => x !== null).length} 題)`;
        ansStatus.className = "badge badge-success";
    }
    
    if (cachedStudentImg && isBaseAnswerReady) {
        const studentAnswers = processGridMapping(cachedStudentImg, offscreenStudentCanvas, 'canvas-student', totalQs, studentCorners, false);
        gradeStudentCard(studentAnswers, totalQs);
    }
}

/**
 * 🔍 核心幾何渲染與動態像素判定分析器
 */
function processGridMapping(imgEl, offscreenCanvas, onscreenCanvasId, totalQs, corners, isBaseConfig = false) {
    const canvas = document.getElementById(onscreenCanvasId);
    const onscreenCtx = canvas.getContext('2d');
    const offscreenCtx = offscreenCanvas.getContext('2d');
    
    onscreenCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    onscreenCtx.drawImage(imgEl, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    
    // 計算區域自適應環境臨界值
    const sample = offscreenCtx.getImageData(TARGET_WIDTH/4, TARGET_HEIGHT/4, TARGET_WIDTH/2, TARGET_HEIGHT/2).data;
    let sSum = 0; for(let i=0; i<sample.length; i+=16) sSum += (sample[i]+sample[i+1]+sample[i+2])/3;
    let dynamicThresh = (sSum / (sample.length / 16)) * 0.74;

    const options = ['A', 'B', 'C', 'D'];
    let paperAnswers = [];
    
    // 生成彈簧網格並進行像素分析
    for (let q = 1; q <= totalQs; q++) {
        let colIdx = Math.floor((q - 1) / 25);
        let rowIdx = (q - 1) % 25;
        
        // 算出該題排行的自適應 V 比例
        let v = CARD_PROPORTIONS.vStart + rowIdx * ((CARD_PROPORTIONS.vEnd - CARD_PROPORTIONS.vStart) / 24);
        let colUStart = CARD_PROPORTIONS.uColStarts[colIdx];
        
        let maxDarkPixels = 0;
        let detectedOptionIndex = -1;
        let optionPixelCounts = [];
        
        for (let o = 0; o < 4; o++) {
            // 精算每個 ABCD 選項的歸一化 U 比例
            let u = colUStart + CARD_PROPORTIONS.uNumWidth + (o * CARD_PROPORTIONS.uOptGap);
            
            // 透過雙線性公式反向解算影像畫布上的絕對像素坐標
            let pt = getInterpolatedPoint(u, v, corners);
            
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
            
            // 繪製高精密微型感應圈 (淡橙色)
            onscreenCtx.strokeStyle = 'rgba(245, 158, 11, 0.28)'; 
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
    
    // 💡 渲染 4 個角落圓形拖曳把手（標準卡綠色，學生卡藍色）
    const handleColor = isBaseConfig ? '#10b981' : '#4f46e5';
    for (let key in corners) {
        onscreenCtx.fillStyle = handleColor;
        onscreenCtx.strokeStyle = '#ffffff';
        onscreenCtx.lineWidth = 2;
        onscreenCtx.beginPath();
        onscreenCtx.arc(corners[key].x, corners[key].y, 10, 0, 2 * Math.PI);
        onscreenCtx.fill();
        onscreenCtx.stroke();
    }
    
    return paperAnswers;
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
        canvas.width = TARGET_WIDTH; canvas.height = TARGET_HEIGHT;
        
        const offCtx = offscreenAnswerCanvas.getContext('2d');
        offCtx.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        offCtx.drawImage(img, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        
        // 🚀 自動獵取黑邊框並更新坐標
        answerCorners = autoDetectFrame(offCtx);
        rerenderAndAnalyzeAll();
    };
    img.src = URL.createObjectURL(file);
});

// 處理學生答案卡上傳
uploadStudent.addEventListener('change', (e) => {
    if (!isBaseAnswerReady) {
        alert('請先在右側設定「正確答案卡」基準！');
        uploadStudent.value = ''; return;
    }
    const file = e.target.files[0];
    if (!file) return;
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
        
        // 🚀 自適應！獨立為這張學生卡獵取邊框坐標，完全解決遠近不同的干擾
        studentCorners = autoDetectFrame(offCtx);
        rerenderAndAnalyzeAll();
    };
    img.src = URL.createObjectURL(file);
});

/**
 * 🖱️ 智慧互動手感模組：解鎖 Canvas Draggable Corners 拖曳控制
 */
function setupCanvasDragEvents(canvasId, cornersObj) {
    const canvas = document.getElementById(canvasId);
    
    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        // 考量到 CSS 響應式縮放，進行精準比例轉換
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
        
        // 檢查點擊是否命中 4 個角落把手的 24px 感應範圍內
        for (let key in cornersObj) {
            let dx = pos.x - cornersObj[key].x;
            let dy = pos.y - cornersObj[key].y;
            if (Math.sqrt(dx*dx + dy*dy) < 24) {
                dragTarget = { canvasId: canvasId, key: key };
                e.preventDefault();
                break;
            }
        }
    }
    
    function handleMove(e) {
        if (!dragTarget || dragTarget.canvasId !== canvasId) return;
        const pos = getMousePos(e);
        
        // 限制座標不得滑出畫布邊界
        cornersObj[dragTarget.key].x = Math.max(0, Math.min(pos.x, TARGET_WIDTH));
        cornersObj[dragTarget.key].y = Math.max(0, Math.min(pos.y, TARGET_HEIGHT));
        
        e.preventDefault();
        rerenderAndAnalyzeAll(); // 即時動態重新編譯插值網格並結算成績
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
    uploadStudent.value = ''; cachedStudentImg = null;
    const canvas = document.getElementById('canvas-student');
    canvas.classList.add('hidden');
    document.querySelector('.drop-wrapper').classList.remove('hidden');
    resultPanel.classList.add('hidden');
});

btnFullReset.addEventListener('click', () => {
    cachedAnswerImg = null; cachedStudentImg = null;
    location.reload(); 
});
