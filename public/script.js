// config
const STUN_SERVER = 'stun:stun.l.google.com:19302';
// free public TURN fallback (openrelay project) - used when a direct
// peer-to-peer connection can't be established (restrictive NAT/firewall)
const TURN_SERVERS = [
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const possibleEmojis = ['👱', '👨', '👩', '👩🏽', '👩🏻', '👩🏿', '👨🏽', '👨🏻', '👨🏿'];
function randomEmoji() {
  return possibleEmojis[Math.floor(Math.random() * possibleEmojis.length)];
}

const emoji = randomEmoji();
let name = '';

// unique id per tab, used to ignore our own signaling messages
const clientId = 'client-' + Math.random().toString(36).substring(2, 10);

let ably;
let roomName;
let channel;

const configuration = {
  iceServers: [{ urls: STUN_SERVER }, ...TURN_SERVERS],
};
let pc;
let dataChannel;

// dom refs
const landingEl = document.getElementById('landing');
const chatContentEl = document.getElementById('chat-content');
const nameInputEl = document.getElementById('name-input');
const nameErrorEl = document.getElementById('name-error');
const choiceEl = document.getElementById('landing-choice');
const joinPanelEl = document.getElementById('landing-join');
const joinInputEl = document.getElementById('join-input');
const joinErrorEl = document.getElementById('join-error');

const statusPillEl = document.getElementById('status-pill');
const statusDotEl = document.getElementById('status-dot');
const statusLabelEl = document.getElementById('status-label');

const roomCodeEl = document.getElementById('room-code');
const shareInputEl = document.getElementById('share-input');
const copyBtnEl = document.getElementById('copy-btn');

const messagesEl = document.getElementById('messages');
const messagesEmptyEl = document.getElementById('messages-empty');
const fullBannerEl = document.getElementById('full-banner');

const messageFormEl = document.getElementById('message-form');
const messageInputEl = document.getElementById('message-input');

// status pill helper
function setStatus(state, label) {
  statusPillEl.hidden = false;
  statusPillEl.dataset.state = state;
  statusLabelEl.textContent = label;
}

// landing screen logic
function validateName() {
  const value = nameInputEl.value.trim();
  if (!value) {
    nameErrorEl.hidden = false;
    nameInputEl.focus();
    return null;
  }
  nameErrorEl.hidden = true;
  return value;
}

document.getElementById('btn-create-room').addEventListener('click', () => {
  const value = validateName();
  if (!value) return;
  name = value;
  location.hash = Math.floor(Math.random() * 0xFFFFFF).toString(16);
  enterChat();
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  if (!validateName()) return;
  choiceEl.hidden = true;
  joinPanelEl.hidden = false;
  joinInputEl.focus();
});

document.getElementById('btn-join-back').addEventListener('click', () => {
  joinPanelEl.hidden = true;
  joinErrorEl.hidden = true;
  choiceEl.hidden = false;
});

document.getElementById('btn-join-submit').addEventListener('click', submitJoin);
joinInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitJoin();
});

// accepts full link or bare code, pulls out the room hash
function extractHash(raw) {
  const value = raw.trim();
  if (!value) return null;
  const hashIndex = value.indexOf('#');
  const code = hashIndex !== -1 ? value.substring(hashIndex + 1) : value;
  const cleaned = code.trim();
  return /^[a-zA-Z0-9]+$/.test(cleaned) ? cleaned : null;
}

function submitJoin() {
  const value = validateName();
  if (!value) {
    joinPanelEl.hidden = true;
    choiceEl.hidden = false;
    return;
  }
  name = value;

  const code = extractHash(joinInputEl.value);
  if (!code) {
    joinErrorEl.hidden = false;
    return;
  }
  joinErrorEl.hidden = true;
  location.hash = code;
  enterChat();
}

function enterChat() {
  const chatHash = location.hash.substring(1);
  roomName = 'void-chat-' + chatHash;

  landingEl.hidden = true;
  chatContentEl.hidden = false;

  roomCodeEl.textContent = '#' + chatHash;
  setupShareBar();
  setupMessageForm();
  setStatus('waiting', 'Waiting for someone to join…');

  connectToSignaling();
}

// skip landing choice if link already has a room hash
if (location.hash) {
  choiceEl.hidden = true;
  joinPanelEl.hidden = true;
  const askNameEl = document.createElement('div');
  askNameEl.innerHTML = '<p class="landing__label" style="margin-top:16px;">You\'re joining an existing room.</p>';
  document.querySelector('.landing__card').appendChild(askNameEl);

  const joinExistingBtn = document.createElement('button');
  joinExistingBtn.className = 'landing__btn landing__btn--primary';
  joinExistingBtn.style.marginTop = '8px';
  joinExistingBtn.style.width = '100%';
  joinExistingBtn.textContent = 'Join This Room';
  joinExistingBtn.addEventListener('click', () => {
    const value = validateName();
    if (!value) return;
    name = value;
    enterChat();
  });
  document.querySelector('.landing__card').appendChild(joinExistingBtn);
}

// signaling setup (ably)
function connectToSignaling() {
  ably = new Ably.Realtime({
    authUrl: '/api/token',
    authParams: { clientId, room: 'void-chat-' + location.hash.substring(1) },
    clientId,
  });

  channel = ably.channels.get(roomName);

  channel.subscribe('signal', (message) => {
    if (message.clientId === clientId) return;
    handleSignalingMessage(message.data);
  });

  channel.presence.subscribe('enter', checkPresenceAndStart);
  channel.presence.subscribe('leave', () => {
    setStatus('disconnected', 'Peer left the room');
  });

  ably.connection.once('connected', () => {
    console.log('Connected to signaling server');
    channel.presence.enter().then(checkPresenceAndStart);
  });

  ably.connection.on('failed', (stateChange) => {
    console.error('Ably connection failed:', stateChange);
    setStatus('disconnected', 'Could not connect — check server config');
  });
}

let webrtcStarted = false;

// decide who's the offerer once 2 people are in the room
function checkPresenceAndStart() {
  if (webrtcStarted) return;
  channel.presence.get().then((members) => {
    if (members.length >= 3) {
      fullBannerEl.hidden = false;
      setStatus('disconnected', 'Room is full');
      messageInputEl.disabled = true;
      messageFormEl.querySelector('button').disabled = true;
      return;
    }
    if (members.length >= 2) {
      webrtcStarted = true;
      const isOfferer = members[0].clientId === clientId;
      setStatus('connecting', 'Connecting…');
      startWebRTC(isOfferer);
    }
  });
}

function sendSignalingMessage(message) {
  channel.publish('signal', message);
}

// webrtc setup
function startWebRTC(isOfferer) {
  console.log('Starting WebRTC as', isOfferer ? 'offerer' : 'waiter');
  pc = new RTCPeerConnection(configuration);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingMessage({ candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      setStatus('disconnected', 'Connection lost');
    }
  };

  if (isOfferer) {
    pc.onnegotiationneeded = () => {
      pc.createOffer().then(localDescCreated).catch((error) => console.error(error));
    };
    dataChannel = pc.createDataChannel('chat');
    setupDataChannel();
  } else {
    pc.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel();
    };
  }
}

// handles incoming sdp / ice candidates from the other peer
function handleSignalingMessage(message) {
  if (!pc) return;

  if (message.sdp) {
    pc.setRemoteDescription(new RTCSessionDescription(message.sdp))
      .then(() => {
        if (pc.remoteDescription.type === 'offer') {
          return pc.createAnswer().then(localDescCreated);
        }
      })
      .catch((error) => console.error(error));
  } else if (message.candidate) {
    pc.addIceCandidate(new RTCIceCandidate(message.candidate)).catch((error) => console.error(error));
  }
}

function localDescCreated(desc) {
  pc.setLocalDescription(desc)
    .then(() => sendSignalingMessage({ sdp: pc.localDescription }))
    .catch((error) => console.error(error));
}

function setupDataChannel() {
  checkDataChannelState();
  dataChannel.onopen = checkDataChannelState;
  dataChannel.onclose = () => setStatus('disconnected', 'Peer disconnected');
  dataChannel.onmessage = (event) => insertMessageToDOM(JSON.parse(event.data), false);
}

function checkDataChannelState() {
  console.log('WebRTC channel state is:', dataChannel.readyState);
  if (dataChannel.readyState === 'open') {
    setStatus('connected', 'Connected');
    insertMessageToDOM({ content: 'You are now connected securely, peer-to-peer.' });
  }
}

// messages
function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function insertMessageToDOM(options, isFromMe) {
  messagesEmptyEl.hidden = true;

  const template = document.querySelector('template[data-template="message"]');
  const clone = document.importNode(template.content, true);

  const nameEl = clone.querySelector('.message__name');
  if (options.emoji || options.name) {
    nameEl.textContent = [options.emoji, options.name].filter(Boolean).join(' ');
  } else {
    nameEl.textContent = 'System';
  }

  clone.querySelector('.message__time').textContent = formatTime(new Date());
  clone.querySelector('.message__bubble').textContent = options.content;

  const messageEl = clone.querySelector('.message');
  messageEl.classList.add(isFromMe ? 'message--mine' : 'message--theirs');

  messagesEl.appendChild(clone);
  messagesEl.scrollTop = messagesEl.scrollHeight - messagesEl.clientHeight;
}

function setupMessageForm() {
  messageFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = messageInputEl.value.trim();
    if (!value || !dataChannel || dataChannel.readyState !== 'open') return;

    messageInputEl.value = '';
    const data = { name, content: value, emoji };
    dataChannel.send(JSON.stringify(data));
    insertMessageToDOM(data, true);
  });
}

// share bar (copy link)
function setupShareBar() {
  shareInputEl.value = location.href;
  shareInputEl.addEventListener('click', () => shareInputEl.select());

  copyBtnEl.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
    } catch (err) {
      shareInputEl.select();
      document.execCommand('copy');
    }
    copyBtnEl.textContent = 'Copied!';
    copyBtnEl.classList.add('copied');
    setTimeout(() => {
      copyBtnEl.textContent = 'Copy';
      copyBtnEl.classList.remove('copied');
    }, 1500);
  });
}
