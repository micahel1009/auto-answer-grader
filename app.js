// ==========================================
// 1. 全域狀態與幾何矩陣常數管理
// ==========================================
let baseAnswerKey = []; 
let isBaseAnswerReady = false;

const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 1100;

// 🎯 瀚浩教育答案卡內部的黃金歸一化比例矩陣 (相對於大黑框的精準百分比)
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

let caliThreshold = 45;
let dragTarget = null; // 追蹤鼠標/手指正在抓哪一個把手

// 離線畫布
let offscreenAnswerCanvas = document.createElement('canvas');
let offscreenStudentCanvas = document.createElement('canvas');
offscreenAnswerCanvas.width = TARGET_WIDTH; offscreenAnswerCanvas.height = TARGET_HEIGHT;
offscreenStudentCanvas.width = TARGET_WIDTH; offscreenStudentCanvas.height = TARGET_HEIGHT;

let cachedAnswerImg = null;
let cachedStudentImg = null;

// ==========================================
// 🌟 核心修復：補齊先前遺漏的 DOM 元素繫結
// ==========================================
const uploadAnswer = document.getElementById('upload-answer');
const uploadStudent = document.getElementById('upload-student');
const btnNextStudent = document.getElementById('btn-next-student');
const btnFullReset = document.getElementById('btn-full-reset');
const resultPanel = document.getElementById('result-panel');
const ansStatus = document.getElementById('ans-status');

// ==========================================
// 2. 監聽器與初使化設定
// ==========================================
document.getElementById('cali-threshold').addEventListener('input', (e) => {
    caliThreshold = parseInt(e.target.value);
    document.getElementById('val-threshold').innerText = caliThreshold;
    rerenderAndAnalyzeAll();
});
document.getElementById('input-total-questions').addEventListener('input', rerenderAndAnalyzeAll);

// 初始化雙畫布的手指/滑鼠解鎖機制
setupCanvasDragEvents('canvas-answer', answerCorners);
setupCanvasDragEvents('canvas-student', studentCorners);

/**
 * 🛠️ 智慧型「結構化網格共振擬合演算法」
 * 透過尋找 5 條等距垂直線與 26 條等距水平線的最大化矩陣投影，徹底秒殺背景干擾！
 */
function autoFitGridMatrix(offCtx) {
    const imgData = offCtx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    const pixels = imgData.data;
    
    // 1. 動態環境採樣臨界值計算
    let graySum = 0, count = 0;
    for (let y = 300; y < 800; y += 20) {
        for (let x = 200; x < 600; x += 20) {
            let idx = (y * TARGET_WIDTH + x) * 4;
            graySum += (pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3;
            count++;
        }
    }
    let threshold = (graySum / count) * 0.75; // 低於此亮度即為印刷黑線墨水
    
    // 2. 建立全圖高精度黑線投影直方圖
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
    
    // 3. 垂直網格共振搜尋 (尋找最佳 X 軸起點與大外框寬度)
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
    
    // 4. 水平網格共振搜尋 (尋找最佳 Y 軸起點與大外框高度)
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
 * ⚡ 雙線性扭曲投影（Bilinear Interpolation Transform）
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
 * 🔍 核心閱卷與幾何映射引擎
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

    const options =
