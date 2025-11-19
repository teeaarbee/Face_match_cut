/**
 * Face Time-Lapse Application Logic
 */

// State
const state = {
    images: [], // { original: Image, aligned: Image, landmarks: Object }
    isModelLoaded: false,
    isPlaying: false,
    currentFrame: 0,
    fps: 10,
    zoom: 0.25, // Default 25% of width
    alignEyes: true,
    canvas: null,
    ctx: null,
    animationId: null,
    gifWorkerBlob: null
};

// DOM Elements
const elements = {
    uploadSection: document.getElementById('uploadSection'),
    editorSection: document.getElementById('editorSection'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    canvas: document.getElementById('previewCanvas'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    progressBarContainer: document.getElementById('progressBarContainer'),
    progressBar: document.getElementById('progressBar'),
    speedRange: document.getElementById('speedRange'),
    speedValue: document.getElementById('speedValue'),
    zoomRange: document.getElementById('zoomRange'),
    autoFitBtn: document.getElementById('autoFitBtn'),
    alignEyesBtn: document.getElementById('alignEyesBtn'),
    noAlignBtn: document.getElementById('noAlignBtn'),
    resetBtn: document.getElementById('resetBtn'),
    exportGifBtn: document.getElementById('exportGifBtn'),
    exportMp4Btn: document.getElementById('exportMp4Btn')
};

// Initialization
async function init() {
    state.canvas = elements.canvas;
    state.ctx = state.canvas.getContext('2d');

    // Setup event listeners
    setupEventListeners();

    // Load models
    try {
        showLoading('Loading AI models...');
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        // Note: Using a reliable CDN path or local path. 
        // For this demo, we'll try to load from the standard face-api CDN or a known working source.
        // Actually, face-api.js default models are often hosted on github pages or similar.
        // Let's use a direct path if possible, or the jsdelivr one.
        // To ensure it works without CORS issues, we might need to be careful.
        // Using the tiny face detector for speed.

        await faceapi.nets.tinyFaceDetector.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models');
        await faceapi.nets.faceLandmark68Net.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models');

        state.isModelLoaded = true;
        hideLoading();
        console.log('Models loaded');

        // Preload GIF worker to avoid CORS issues
        fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js')
            .then(resp => resp.text())
            .then(text => {
                const blob = new Blob([text], { type: 'application/javascript' });
                state.gifWorkerBlob = URL.createObjectURL(blob);
            });

    } catch (error) {
        console.error('Error loading models:', error);
        showLoading('Error loading AI models. Please refresh.');
    }
}

function setupEventListeners() {
    // File Upload
    elements.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.dropZone.classList.add('drag-over');
    });

    elements.dropZone.addEventListener('dragleave', () => {
        elements.dropZone.classList.remove('drag-over');
    });

    elements.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    elements.fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // Controls
    elements.speedRange.addEventListener('input', (e) => {
        state.fps = parseInt(e.target.value);
        elements.speedValue.textContent = `${state.fps} fps`;
    });

    elements.zoomRange.addEventListener('input', (e) => {
        state.zoom = parseInt(e.target.value) / 100;
        // Re-render if paused
        if (!state.isPlaying && state.images.length > 0) {
            renderFrame(state.currentFrame);
        }
    });

    elements.autoFitBtn.addEventListener('click', autoFitZoom);

    elements.alignEyesBtn.addEventListener('click', () => {
        setAlignMode(true);
    });

    elements.noAlignBtn.addEventListener('click', () => {
        setAlignMode(false);
    });

    elements.resetBtn.addEventListener('click', resetApp);

    elements.exportGifBtn.addEventListener('click', exportGif);
    elements.exportMp4Btn.addEventListener('click', exportMp4);
}

function setAlignMode(align) {
    state.alignEyes = align;
    elements.alignEyesBtn.classList.toggle('active', align);
    elements.noAlignBtn.classList.toggle('active', !align);
    // Re-render current frame immediately if paused, or it will update on next frame
}

async function handleFiles(fileList) {
    if (!state.isModelLoaded) {
        alert('Models are still loading, please wait...');
        return;
    }

    const files = Array.from(fileList).filter(f => {
        return f.type.startsWith('image/') ||
            f.name.toLowerCase().endsWith('.heic') ||
            f.name.toLowerCase().endsWith('.heif');
    });
    if (files.length === 0) return;

    showLoading(`Processing ${files.length} images...`);
    elements.uploadSection.classList.add('hidden');
    elements.editorSection.classList.remove('hidden');

    state.images = [];

    // Process images sequentially to avoid memory spikes
    for (let i = 0; i < files.length; i++) {
        const progress = Math.round(((i) / files.length) * 100);
        showLoading(`Processing image ${i + 1} of ${files.length}...`, progress);
        try {
            let fileToProcess = files[i];

            // Check if HEIC/HEIF and convert
            if (fileToProcess.name.toLowerCase().endsWith('.heic') || fileToProcess.name.toLowerCase().endsWith('.heif')) {
                showLoading(`Converting HEIC image ${i + 1}...`, progress);
                try {
                    const convertedBlob = await heic2any({
                        blob: fileToProcess,
                        toType: "image/jpeg",
                        quality: 0.8
                    });
                    // Handle case where heic2any returns an array (for multi-image HEIC)
                    const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
                    fileToProcess = blob;
                } catch (e) {
                    console.error('HEIC conversion failed:', e);
                    throw new Error('HEIC conversion failed');
                }
            }

            const img = await loadImage(fileToProcess);
            const detections = await detectFace(img);

            state.images.push({
                original: img,
                detections: detections
            });
        } catch (err) {
            console.warn(`Failed to process image ${files[i].name}`, err);
        }
    }

    if (state.images.length > 0) {
        // Set canvas size based on first image (or fixed size)
        // For better consistency, let's pick a standard HD size or match the first image aspect ratio
        const firstImg = state.images[0].original;
        state.canvas.width = firstImg.width;
        state.canvas.height = firstImg.height;

        hideLoading();
        startPlayback();
    } else {
        alert('No valid images found.');
        resetApp();
    }
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

async function detectFace(img) {
    // Using TinyFaceDetector for performance
    const detections = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
    return detections;
}

function startPlayback() {
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.isPlaying = true;
    state.currentFrame = 0;

    let lastTime = 0;

    function loop(timestamp) {
        if (!state.isPlaying) return;

        const interval = 1000 / state.fps;
        if (timestamp - lastTime > interval) {
            renderFrame(state.currentFrame);
            state.currentFrame = (state.currentFrame + 1) % state.images.length;
            lastTime = timestamp;
        }

        state.animationId = requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
}

function renderFrame(index) {
    const item = state.images[index];
    if (!item) return;

    const ctx = state.ctx;
    const canvas = state.canvas;

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (state.alignEyes && item.detections) {
        const landmarks = item.detections.landmarks;
        const leftEye = landmarks.getLeftEye();
        const rightEye = landmarks.getRightEye();

        // Get center of each eye
        const leftEyeCenter = getCentroid(leftEye);
        const rightEyeCenter = getCentroid(rightEye);

        // Calculate angle to rotate
        const dx = rightEyeCenter.x - leftEyeCenter.x;
        const dy = rightEyeCenter.y - leftEyeCenter.y;
        const angle = Math.atan2(dy, dx);

        // Calculate center point between eyes
        const eyesCenter = {
            x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
            y: (leftEyeCenter.y + rightEyeCenter.y) / 2
        };

        // Desired settings (could be configurable)
        // We want the eyes center to be at 50% width, 40% height of canvas
        // We want the distance between eyes to be constant based on zoom
        const desiredEyesDist = canvas.width * state.zoom;
        const currentEyesDist = Math.sqrt(dx * dx + dy * dy);
        const scale = desiredEyesDist / currentEyesDist;

        const targetX = canvas.width * 0.5;
        const targetY = canvas.height * 0.4;

        ctx.save();

        // Move to target center
        ctx.translate(targetX, targetY);

        // Scale
        ctx.scale(scale, scale);

        // Rotate (negative to correct)
        ctx.rotate(-angle);

        // Move back from eyes center
        ctx.translate(-eyesCenter.x, -eyesCenter.y);

        ctx.drawImage(item.original, 0, 0);

        ctx.restore();
    } else {
        // Center image in canvas if not aligned or no detection
        const scale = Math.min(canvas.width / item.original.width, canvas.height / item.original.height);
        const x = (canvas.width - item.original.width * scale) / 2;
        const y = (canvas.height - item.original.height * scale) / 2;

        ctx.drawImage(item.original, x, y, item.original.width * scale, item.original.height * scale);
    }
}

function getCentroid(points) {
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
}

function autoFitZoom() {
    if (state.images.length === 0) return;

    showLoading('Calculating optimal zoom...');

    // We need to find the minimum zoom (scale) that keeps all images within bounds
    // But wait, "zoom" in our state is actually "desiredEyesDist / canvasWidth".
    // A smaller zoom value means smaller face = more context = less cropping.
    // So we want to find the MAXIMUM zoom value that still fits everything?
    // No, we want to find the zoom value such that for ALL images, the transformed corners are within the canvas.
    // Actually, usually we want to "Zoom Out" enough so nothing is cut.
    // So we are looking for the largest possible face size (zoom) where no image corners are outside the canvas.

    // Let's iterate and find the safe zoom for each image, then take the minimum of those safe zooms.

    let minSafeZoom = 1.0; // Start with max possible (100% width eyes distance is huge)

    const canvasWidth = state.canvas.width;
    const canvasHeight = state.canvas.height;
    const targetX = canvasWidth * 0.5;
    const targetY = canvasHeight * 0.4;

    state.images.forEach(item => {
        if (!item.detections) return;

        const landmarks = item.detections.landmarks;
        const leftEye = landmarks.getLeftEye();
        const rightEye = landmarks.getRightEye();
        const leftEyeCenter = getCentroid(leftEye);
        const rightEyeCenter = getCentroid(rightEye);

        const dx = rightEyeCenter.x - leftEyeCenter.x;
        const dy = rightEyeCenter.y - leftEyeCenter.y;
        const currentEyesDist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        const eyesCenter = {
            x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
            y: (leftEyeCenter.y + rightEyeCenter.y) / 2
        };

        // We need to solve for 'scale' such that when transformed, all 4 corners are within [0, width] and [0, height].
        // Transform T(x,y):
        // 1. Translate(-eyesCenter.x, -eyesCenter.y)
        // 2. Rotate(-angle)
        // 3. Scale(s)
        // 4. Translate(targetX, targetY)
        //
        // X_final = s * ( (x - cx)*cos(-a) - (y - cy)*sin(-a) ) + tx
        // Y_final = s * ( (x - cx)*sin(-a) + (y - cy)*cos(-a) ) + ty
        //
        // We want 0 <= X_final <= W and 0 <= Y_final <= H for all 4 corners.
        // This gives us upper bounds on 's'.

        const corners = [
            { x: 0, y: 0 },
            { x: item.original.width, y: 0 },
            { x: item.original.width, y: item.original.height },
            { x: 0, y: item.original.height }
        ];

        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);

        let maxScaleForThisImage = Infinity;

        corners.forEach(p => {
            // Coordinates relative to eyes center, rotated
            const relX = p.x - eyesCenter.x;
            const relY = p.y - eyesCenter.y;

            const rotX = relX * cos - relY * sin;
            const rotY = relX * sin + relY * cos;

            // X_final = s * rotX + targetX
            // 0 <= s * rotX + targetX <= W
            // -targetX <= s * rotX <= W - targetX

            // If rotX > 0: s <= (W - targetX) / rotX
            // If rotX < 0: s <= -targetX / rotX  (which is positive)

            if (rotX > 0) maxScaleForThisImage = Math.min(maxScaleForThisImage, (canvasWidth - targetX) / rotX);
            else if (rotX < 0) maxScaleForThisImage = Math.min(maxScaleForThisImage, -targetX / rotX);

            // Y_final = s * rotY + targetY
            // 0 <= s * rotY + targetY <= H

            if (rotY > 0) maxScaleForThisImage = Math.min(maxScaleForThisImage, (canvasHeight - targetY) / rotY);
            else if (rotY < 0) maxScaleForThisImage = Math.min(maxScaleForThisImage, -targetY / rotY);
        });

        // Convert scale back to zoom (eyes dist ratio)
        // scale = (canvasWidth * zoom) / currentEyesDist
        // zoom = (scale * currentEyesDist) / canvasWidth

        const safeZoom = (maxScaleForThisImage * currentEyesDist) / canvasWidth;
        minSafeZoom = Math.min(minSafeZoom, safeZoom);
    });

    // Apply with a small margin (e.g. 95%) to be safe
    const finalZoom = Math.floor(minSafeZoom * 0.95 * 100) / 100;

    // Clamp to slider limits
    const clampedZoom = Math.max(0.1, Math.min(1.0, finalZoom));

    state.zoom = clampedZoom;
    elements.zoomRange.value = Math.round(clampedZoom * 100);

    hideLoading();

    // Re-render
    if (!state.isPlaying) renderFrame(state.currentFrame);
}

function resetApp() {
    state.isPlaying = false;
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.images = [];
    elements.editorSection.classList.add('hidden');
    elements.uploadSection.classList.remove('hidden');
    elements.fileInput.value = '';
}

function showLoading(text, progress = -1) {
    elements.loadingText.textContent = text;
    elements.loadingOverlay.classList.remove('hidden');

    if (progress >= 0) {
        elements.progressBarContainer.classList.remove('hidden');
        elements.progressBar.style.width = `${progress}%`;
    } else {
        elements.progressBarContainer.classList.add('hidden');
    }
}

function hideLoading() {
    elements.loadingOverlay.classList.add('hidden');
}

// Export Functions
async function exportGif() {
    if (state.images.length === 0) return;

    showLoading('Generating GIF...', 0);

    // Pause playback during export
    const wasPlaying = state.isPlaying;
    state.isPlaying = false;
    if (state.animationId) cancelAnimationFrame(state.animationId);

    try {
        const gif = new GIF({
            workers: 2,
            quality: 10,
            width: state.canvas.width,
            height: state.canvas.height,
            workerScript: state.gifWorkerBlob || 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js'
        });

        // Add frames
        for (let i = 0; i < state.images.length; i++) {
            renderFrame(i);
            gif.addFrame(state.canvas, { delay: 1000 / state.fps, copy: true });
            showLoading('Adding frames...', Math.round((i / state.images.length) * 50));
        }

        gif.on('progress', (p) => {
            showLoading('Rendering GIF...', 50 + Math.round(p * 50));
        });

        gif.on('finished', (blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'face-timelapse.gif';
            a.click();
            hideLoading();
            if (wasPlaying) startPlayback();
        });

        gif.render();

    } catch (error) {
        console.error('GIF Export failed:', error);
        alert('Failed to export GIF. See console for details.');
        hideLoading();
        if (wasPlaying) startPlayback();
    }
}

async function exportMp4() {
    if (state.images.length === 0) return;

    showLoading('Generating Video...');

    // Pause playback
    const wasPlaying = state.isPlaying;
    state.isPlaying = false;
    if (state.animationId) cancelAnimationFrame(state.animationId);

    try {
        const stream = state.canvas.captureStream(state.fps);

        // Try to use MP4 if supported, otherwise WebM
        let mimeType = 'video/webm;codecs=vp9';
        let ext = 'webm';

        if (MediaRecorder.isTypeSupported('video/mp4')) {
            mimeType = 'video/mp4';
            ext = 'mp4';
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
            mimeType = 'video/webm;codecs=h264';
            ext = 'mp4'; // Often playable as mp4
        }

        const mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType
        });

        const chunks = [];
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `face-timelapse.${ext}`;
            a.click();
            hideLoading();
            if (wasPlaying) startPlayback();
        };

        mediaRecorder.start();

        // Play through frames for recording
        for (let i = 0; i < state.images.length; i++) {
            renderFrame(i);
            // Wait for frame duration
            await new Promise(r => setTimeout(r, 1000 / state.fps));
        }

        mediaRecorder.stop();

    } catch (error) {
        console.error('Video Export failed:', error);
        alert('Failed to export video. Your browser might not support MediaRecorder.');
        hideLoading();
        if (wasPlaying) startPlayback();
    }
}

// Start
init();
