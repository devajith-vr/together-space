// ==========================================
// Together — A Space for Two
// Real device-to-device sync via PeerJS (WebRTC)
// Same-tab/same-browser fallback via BroadcastChannel
// ==========================================
'use strict';

// ── State ──
let currentRoomCode = null;
let currentUserName = null;
let isCreator       = false;
let peer            = null;   // Our PeerJS instance
let conn            = null;   // Active DataConnection to partner
let peerReady       = false;
let controlsLocked  = false;
let hideControlsTimeout = null;
let currentBrightness   = 1;
let touchStartX = 0, touchStartY = 0;
let swipeDir    = null;
let isSeeking   = false;
let seekStartTime = 0;
let lastTap     = 0;
let bc          = null; // BroadcastChannel (same-browser fallback)
let connectionStartTime = null;
let connectionTimerInterval = null;

// ── DOM Refs ──
const loginScreen     = document.getElementById('loginScreen');
const appScreen       = document.getElementById('app');
const headerRoomBadge = document.getElementById('headerRoomBadge');
const presenceBadge   = document.getElementById('presenceBadge');
const presenceNames   = document.getElementById('presenceNames');
const btnLeaveSpace   = document.getElementById('btnLeaveSpace');
const chatInput       = document.getElementById('chatInput');
const chatScroller    = document.getElementById('chatScroller');
const chatForm        = document.getElementById('chatForm');
const btnSendChat     = document.getElementById('btnSendChat');
const chatStatusDot   = document.getElementById('chatStatusDot');
const chatPresence    = document.getElementById('chatPresenceIndicator');
const connectionTime  = document.getElementById('connectionBadgeTime');
const btnSendHeart    = document.getElementById('btnSendHeart');
const creatorToggleCt = document.getElementById('creatorToggleContainer');
const creatorToggle   = document.getElementById('creatorShareToggle');
const partnerLock     = document.getElementById('partnerLockOverlay');
const videoDropzone   = document.getElementById('videoDropzone');
const videoFileInput  = document.getElementById('videoFileInput');
const btnSelectVideo  = document.getElementById('btnSelectVideo');
const playerWrapper   = document.getElementById('videoPlayerWrapper');
const mainVideo       = document.getElementById('mainVideo');
const btnPlayPause    = document.getElementById('btnVideoPlayPause');
const timeDisplay     = document.getElementById('videoTimeDisplay');
const btnMute         = document.getElementById('btnVideoMute');
const volumeSlider    = document.getElementById('videoVolume');
const btnFullscreen   = document.getElementById('btnVideoFullscreen');
const btnChangeVideo  = document.getElementById('btnChangeVideo');
const progressSlider  = document.getElementById('videoProgress');
const brightnessLayer = document.getElementById('brightnessOverlay');
const btnCenterPlay   = document.getElementById('btnCenterPlayPause');
const btnLock         = document.getElementById('btnLockControls');
const btnUnlockOvl    = document.getElementById('btnUnlockOverlay');
const btnUnlock       = document.getElementById('btnUnlockControls');
const leftIndicator   = document.getElementById('leftIndicator');
const leftFill        = document.getElementById('leftIndicatorFill');
const leftText        = document.getElementById('leftIndicatorText');
const rightIndicator  = document.getElementById('rightIndicator');
const rightFill       = document.getElementById('rightIndicatorFill');
const rightText       = document.getElementById('rightIndicatorText');
const seekIndicator   = document.getElementById('seekIndicator');
const seekTime        = document.getElementById('seekIndicatorTime');
const seekDiff        = document.getElementById('seekIndicatorDiff');
const videoControls   = document.getElementById('customVideoControls');
const floatingHearts  = document.getElementById('floatingHearts');
const notifications   = document.getElementById('notifications');
const peerStatusBadge = document.getElementById('peerStatusBadge');

// ── Helpers ──
function generateCode() {
    return Array.from({ length: 6 }, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]
    ).join('');
}

function formatTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function escapeHTML(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}

function showToast(msg, duration = 3500) {
    const t = document.createElement('div');
    t.className = 'notif-toast';
    t.textContent = msg;
    notifications.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(12px)';
        t.style.transition = '0.4s';
        setTimeout(() => t.remove(), 400);
    }, duration);
}

function setPeerStatus(text, color) {
    if (!peerStatusBadge) return;
    peerStatusBadge.textContent = text;
    peerStatusBadge.style.color = color || 'var(--muted)';
}

// ══════════════════════════════════════════
//  PEER-TO-PEER (PeerJS)
// ══════════════════════════════════════════

/**
 * PEER ID SCHEME:
 *   Creator  → peer ID = "tog-<ROOMCODE>-host"
 *   Partner  → peer ID = "tog-<ROOMCODE>-<randomSuffix>"
 *
 * The partner always CALLS the creator's known peer ID.
 * This removes the need for a shared backend to exchange IDs.
 */

function creatorPeerId(code) {
    return `tog-${code.toUpperCase()}-host`;
}

// Send a structured message to partner over PeerJS
function peerSend(type, payload) {
    if (conn && conn.open) {
        try { conn.send({ type, payload, sender: currentUserName }); } catch(e) {}
    }
    // Also broadcast to same-browser tabs
    if (bc) { try { bc.postMessage({ type, payload, sender: currentUserName }); } catch(e) {} }
}

// Handle incoming messages (both PeerJS and BroadcastChannel)
function handleMessage(msg) {
    if (!msg || !msg.type) return;
    const { type, payload } = msg;
    switch (type) {
        case 'handshake':
            // Partner sent their name
            partnerName = payload.name;
            setConnected(msg.sender);
            // Reply with our name
            peerSend('handshake_ack', { name: currentUserName });
            break;
        case 'handshake_ack':
            partnerName = payload.name;
            setConnected(msg.sender);
            break;
        case 'chat':
            appendChatBubble(msg.sender, payload.text, payload.time, false);
            break;
        case 'heart':
            showFloatingHearts(5);
            break;
        case 'theme':
            applyTheme(payload.theme, false);
            syncThemeButtons(payload.theme);
            break;
        case 'perm':
            sharePermission = payload.allowed;
            applyPermissionUI();
            break;
        case 'video_state':
            applyRemoteVideoState(payload);
            break;
        case 'disconnect':
            setDisconnected();
            break;
    }
}

let partnerName = null;
let sharePermission = true;

function setupConnectionHandlers(c) {
    conn = c;
    conn.on('open', () => {
        peerSend('handshake', { name: currentUserName });
        setPeerStatus('Connecting…', 'var(--pink)');
    });
    conn.on('data', (data) => handleMessage(data));
    conn.on('close', () => {
        setDisconnected();
        // Try to reconnect if we are the joiner
        if (!isCreator) setTimeout(() => attemptJoin(), 3000);
    });
    conn.on('error', (err) => {
        console.warn('Peer conn error:', err);
        setPeerStatus('Connection error', '#FF6B6B');
    });
}

function setConnected(name) {
    partnerName  = name;
    connectionStartTime = Date.now();

    // UI
    presenceBadge.classList.remove('hidden');
    presenceNames.textContent = isCreator
        ? `${currentUserName} & ${name}`
        : `${name} & ${currentUserName}`;
    btnLeaveSpace.classList.remove('hidden');
    chatStatusDot.classList.add('online');
    chatPresence.textContent = `${name} is here ❤️`;
    chatInput.disabled = false;
    chatInput.placeholder = 'Send a sweet message...';
    btnSendChat.classList.remove('hidden');
    connectionTime.classList.remove('hidden');
    setPeerStatus('Connected ✓', '#4ECB7A');

    startConnectionTimer();
    showToast(`${name} joined your space 💌`);
}

function setDisconnected() {
    conn = null;
    partnerName = null;
    clearInterval(connectionTimerInterval);

    presenceNames.textContent = 'Waiting for partner...';
    btnLeaveSpace.classList.add('hidden');
    chatStatusDot.classList.remove('online');
    chatPresence.textContent = 'Waiting for partner...';
    chatInput.disabled = true;
    chatInput.placeholder = 'Waiting for partner to connect...';
    btnSendChat.classList.add('hidden');
    connectionTime.classList.add('hidden');
    connectionTime.textContent = '';
    setPeerStatus('Partner disconnected', '#FF6B6B');
    showToast('Partner disconnected 💔');
}

function startConnectionTimer() {
    clearInterval(connectionTimerInterval);
    connectionTimerInterval = setInterval(() => {
        if (!connectionStartTime) return;
        const elapsed = Math.floor((Date.now() - connectionStartTime) / 1000);
        const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        connectionTime.textContent = `Connected ${m}:${s}`;
    }, 1000);
}

// Creator: open a peer and WAIT for partner to call
function initAsCreator(code) {
    const pid = creatorPeerId(code);
    setPeerStatus('Setting up room…', 'var(--muted)');

    peer = new Peer(pid, { debug: 0 });

    peer.on('open', (id) => {
        peerReady = true;
        setPeerStatus('Waiting for partner…', 'var(--muted)');
        showToast('Room ready! Share the code 🔑');
    });

    peer.on('connection', (c) => {
        setupConnectionHandlers(c);
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            // ID taken — creator already exists, fall through gracefully
            setPeerStatus('Room active elsewhere', '#FF6B6B');
            showToast('Room code already in use. Try a new code.');
        } else {
            setPeerStatus('Peer error', '#FF6B6B');
            console.warn('Peer error:', err);
        }
    });

    peer.on('disconnected', () => peer.reconnect());
}

// Partner: connect TO the creator's peer ID
function attemptJoin() {
    if (!currentRoomCode) return;
    const targetId = creatorPeerId(currentRoomCode);
    if (!peer || peer.destroyed) {
        const suffix = Math.random().toString(36).substr(2, 6);
        peer = new Peer(`tog-${currentRoomCode}-${suffix}`, { debug: 0 });
        peer.on('open', () => {
            peerReady = true;
            doConnect(targetId);
        });
        peer.on('error', (err) => {
            console.warn('Peer error (joiner):', err);
            setPeerStatus('Connection failed — retrying…', '#FF6B6B');
            setTimeout(() => attemptJoin(), 4000);
        });
        peer.on('disconnected', () => peer.reconnect());
    } else if (peerReady) {
        doConnect(targetId);
    }
}

function doConnect(targetId) {
    setPeerStatus('Connecting to room…', 'var(--muted)');
    const c = peer.connect(targetId, { reliable: true });
    setupConnectionHandlers(c);
}

// BroadcastChannel (same-browser fallback)
function initBroadcast(code) {
    try {
        bc = new BroadcastChannel(`together_${code}`);
        bc.onmessage = (e) => {
            // Only handle if sender is not us (different tab)
            if (e.data && e.data.sender !== currentUserName) handleMessage(e.data);
        };
    } catch(e) { bc = null; }
}

// ══════════════════════════════════════════
//  LOGIN FLOW
// ══════════════════════════════════════════

function showStep(id) {
    document.querySelectorAll('.login-step').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

document.getElementById('btnShowCreate').addEventListener('click', () => showStep('stepCreate'));
document.getElementById('btnShowJoin').addEventListener('click',   () => showStep('stepJoin'));
document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => showStep(btn.dataset.back));
});

document.getElementById('createRoomForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('createYourName').value.trim();
    if (!name) return;
    const code = generateCode();
    document.getElementById('generatedCodeDisplay').textContent = code;
    const btn = document.getElementById('btnEnterCreatedRoom');
    btn.dataset.code = code;
    btn.dataset.name = name;
    showStep('stepCode');
});

document.getElementById('btnEnterCreatedRoom').addEventListener('click', (e) => {
    enterRoom(e.target.dataset.code, e.target.dataset.name, true);
});

document.getElementById('joinRoomForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = document.getElementById('joinRoomCode').value.trim().toUpperCase();
    const name = document.getElementById('joinYourName').value.trim();
    if (!code || !name) return;
    enterRoom(code, name, false);
});

function enterRoom(code, name, asCreator) {
    currentRoomCode = code;
    currentUserName = name;
    isCreator       = asCreator;

    headerRoomBadge.textContent = `Room: ${code}`;

    // Creator toggle visibility
    if (isCreator) {
        creatorToggleCt.classList.remove('hidden');
    } else {
        creatorToggleCt.classList.add('hidden');
    }

    // Transition to app
    loginScreen.style.transition = 'opacity 0.5s ease';
    loginScreen.style.opacity    = '0';
    setTimeout(() => {
        loginScreen.style.display = 'none';
        appScreen.classList.remove('hidden');
    }, 500);

    // Setup networking
    initBroadcast(code);
    if (asCreator) {
        initAsCreator(code);
    } else {
        setPeerStatus('Looking for room…', 'var(--muted)');
        attemptJoin();
    }

    // Init all features
    initMoodPicker();
    initVideoDropzone();
    initVideoPlayer();
    initChat();
    initHeartBtn();
    initLeaveBtn();
    initParticles();

    showToast(`Welcome, ${name}! 💌`);
}

// ══════════════════════════════════════════
//  PERMISSION TOGGLE (creator only)
// ══════════════════════════════════════════
creatorToggle.addEventListener('change', () => {
    sharePermission = creatorToggle.checked;
    peerSend('perm', { allowed: sharePermission });
    applyPermissionUI();
    showToast(sharePermission ? 'Partner allowed to share videos' : 'Partner sharing locked');
});

function applyPermissionUI() {
    if (!isCreator) {
        if (sharePermission) {
            partnerLock.classList.add('hidden');
            if (btnChangeVideo) btnChangeVideo.classList.remove('hidden');
        } else {
            partnerLock.classList.remove('hidden');
            if (btnChangeVideo) btnChangeVideo.classList.add('hidden');
        }
    } else {
        partnerLock.classList.add('hidden');
        if (btnChangeVideo) btnChangeVideo.classList.remove('hidden');
    }
}

// ══════════════════════════════════════════
//  CHAT
// ══════════════════════════════════════════
function initChat() {
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        if (!conn || !conn.open) {
            showToast('Wait for your partner to connect first 💌');
            return;
        }
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        appendChatBubble(currentUserName, text, timeStr, true);
        peerSend('chat', { text, time: timeStr });
        chatInput.value = '';
    });

    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.dataset.emoji;
            if (!conn || !conn.open) { showToast('Partner not connected yet 💌'); return; }
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            appendChatBubble(currentUserName, emoji, timeStr, true);
            peerSend('chat', { text: emoji, time: timeStr });
        });
    });
}

function appendChatBubble(senderName, text, time, isYou) {
    const b = document.createElement('div');
    b.className = `chat-bubble ${isYou ? 'you' : 'partner'}`;
    b.innerHTML = `
        <span class="bubble-name">${isYou ? 'You' : escapeHTML(senderName)}</span>
        <div class="bubble-text">${escapeHTML(text)}</div>
        <span class="bubble-time">${time}</span>
    `;
    chatScroller.appendChild(b);
    chatScroller.scrollTop = chatScroller.scrollHeight;
}

// ══════════════════════════════════════════
//  HEARTS
// ══════════════════════════════════════════
function initHeartBtn() {
    btnSendHeart.addEventListener('click', () => {
        showFloatingHearts(6);
        peerSend('heart', {});
    });
}

function showFloatingHearts(count) {
    const emojis = ['❤️', '💕', '💗', '💖', '💓', '🌸', '💝'];
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const h = document.createElement('div');
            h.className = 'float-heart';
            h.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            h.style.left     = `${10 + Math.random() * 80}%`;
            h.style.fontSize = `${1.2 + Math.random() * 1.6}rem`;
            h.style.animationDuration = `${2.5 + Math.random() * 2}s`;
            h.style.animationDelay    = `${Math.random() * 0.3}s`;
            floatingHearts.appendChild(h);
            h.addEventListener('animationend', () => h.remove());
        }, i * 130);
    }
}

// ══════════════════════════════════════════
//  MOOD / THEME
// ══════════════════════════════════════════
function initMoodPicker() {
    document.querySelectorAll('.mood-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            syncThemeButtons(theme);
            applyTheme(theme, true);
        });
    });
}

function syncThemeButtons(theme) {
    document.querySelectorAll('.mood-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.theme === theme);
    });
}

function applyTheme(theme, broadcast) {
    document.body.setAttribute('data-theme', theme === 'rose' ? '' : theme);
    if (broadcast) peerSend('theme', { theme });
}

// ══════════════════════════════════════════
//  LEAVE
// ══════════════════════════════════════════
function initLeaveBtn() {
    btnLeaveSpace.addEventListener('click', () => {
        peerSend('disconnect', {});
        if (peer) { try { peer.destroy(); } catch(e) {} }
        location.reload();
    });
}

// ══════════════════════════════════════════
//  VIDEO DROPZONE
// ══════════════════════════════════════════
function initVideoDropzone() {
    videoDropzone.addEventListener('dragover', (e) => {
        e.preventDefault(); videoDropzone.classList.add('drag-over');
    });
    videoDropzone.addEventListener('dragleave', () => videoDropzone.classList.remove('drag-over'));
    videoDropzone.addEventListener('drop', (e) => {
        e.preventDefault(); videoDropzone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) loadLocalVideo(file);
    });
    btnSelectVideo.addEventListener('click', (e) => { e.stopPropagation(); videoFileInput.click(); });
    videoDropzone.addEventListener('click', () => videoFileInput.click());
    videoFileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) loadLocalVideo(e.target.files[0]);
    });
    btnChangeVideo?.addEventListener('click', () => 
