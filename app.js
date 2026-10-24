const desktopGate = document.getElementById("desktop-gate");
const rotateGate = document.getElementById("rotate-gate");
const fit = document.getElementById("fit");
const screen = document.getElementById("screen");
const camera = document.getElementById("camera");
const mesh = document.getElementById("mesh");
const apeCanvas = document.getElementById("ape");
const grab = document.getElementById("grab");
const flash = document.getElementById("flash");
const shutter = document.getElementById("shutter");
const thumb = document.getElementById("thumb");
const flip = document.getElementById("flip");
const notice = document.getElementById("notice");
const noticeText = document.getElementById("notice-text");
const retry = document.getElementById("retry");
const rec = document.getElementById("rec");
const recTime = document.getElementById("rec-time");
const apeButtons = [...document.querySelectorAll(".ape")];
const modeButtons = [...document.querySelectorAll(".mode")];

const grabCtx = grab.getContext("2d");
const meshCtx = mesh.getContext("2d");

const VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const APE_MODELS = {
  al: "assets/Ape_2.glb?v=2",
  dav: "assets/Ape_1.glb?v=4",
};

let facing = "user";
let mode = "photo";
let stream = null;
let recorder = null;
let audioStream = null;
let chunks = [];
let recording = false;
let drawTimer = 0;
let recStarted = 0;
let recTicker = 0;
let lastBlob = null;
let lastUrl = "";
let lastName = "";
let opening = false;
let shown = "";
let faceApi = null;
let drawing = null;
let tracker = null;
let trackerPromise = null;
let tracking = false;
let trackFrame = 0;
let lastVideoTime = -1;
let lastStamp = 0;
let smoothed = null;
let THREE = null;
let apeScene = null;
let apeCamera = null;
let apeRenderer = null;
let apeRig = null;
let apeAnchor = null;
let apeReady = false;
let apeHasPose = false;
let apePromise = null;
let apeMorphs = [];
let shapeWeights = {};
let apeChoice = "al";
let apeTicket = 0;
const poseFilter = {
  ready: false,
  time: 0,
  position: null,
  quaternion: null,
  scale: 0,
};

function viewportBox() {
  const viewport = window.visualViewport;
  if (!viewport) {
    return { width: window.innerWidth, height: window.innerHeight, top: 0, left: 0 };
  }
  return {
    width: viewport.width,
    height: viewport.height,
    top: viewport.offsetTop,
    left: viewport.offsetLeft,
  };
}

function phoneLayout() {
  const box = viewportBox();
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const shortest = Math.min(box.width, box.height);
  const mobileUa = /iPhone|iPod|Android.+Mobile|Windows Phone/i.test(navigator.userAgent);
  return (coarse || mobileUa) && shortest <= 540;
}

function isLocalHost() {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function layoutState() {
  const box = viewportBox();
  if (isLocalHost()) return "app";
  if (!phoneLayout()) return "desktop";
  if (box.width > box.height) return "rotate";
  return "app";
}

function fitScreen() {
  const box = viewportBox();
  fit.style.top = `${box.top}px`;
  fit.style.left = `${box.left}px`;
  fit.style.right = "auto";
  fit.style.bottom = "auto";
  fit.style.width = `${box.width}px`;
  fit.style.height = `${box.height}px`;
  screen.style.transform = "none";
  fit.style.paddingBottom = "0";
}

function show(state) {
  const changed = state !== shown;
  shown = state;
  desktopGate.hidden = state !== "desktop";
  rotateGate.hidden = state !== "rotate";
  fit.hidden = state !== "app";
  if (state === "app") {
    fitScreen();
    if (changed || !stream) openCamera();
  } else if (changed) {
    stopRecording();
    stopCamera();
  }
}

function showNotice(message) {
  noticeText.textContent = message;
  notice.hidden = false;
}

function hideNotice() {
  notice.hidden = true;
}

function stopCamera() {
  stopTracking();
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  camera.srcObject = null;
  shutter.disabled = true;
}

async function openCamera() {
  if (opening || fit.hidden) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showNotice("This browser can’t open the camera. Use Safari or Chrome on your phone.");
    return;
  }

  opening = true;
  shutter.disabled = true;
  stopCamera();

  try {
    stream = await requestCamera();
    if (fit.hidden) {
      stopCamera();
      return;
    }
    camera.srcObject = stream;
    camera.classList.toggle("is-mirror", facing === "user");
    mesh.classList.toggle("is-mirror", facing === "user");
    apeCanvas.classList.toggle("is-mirror", facing === "user");
    await camera.play();
    hideNotice();
    shutter.disabled = false;
    startTracking();
  } catch (error) {
    showNotice(cameraFailureMessage(error));
  } finally {
    opening = false;
  }
}

async function requestCamera() {
  const preferred = {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };
  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (error) {
    if (error && (error.name === "OverconstrainedError" || error.name === "NotFoundError")) {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    throw error;
  }
}

function cameraFailureMessage(error) {
  const name = error && error.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Allow camera access to take a photo or video.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "This simulator has no camera. Open the page on an iPhone to use it.";
  }
  return "The camera didn’t open. Check that it isn’t in use, then try again.";
}

function paintFrame() {
  const width = camera.videoWidth;
  const height = camera.videoHeight;
  if (!width || !height) return false;
  if (grab.width !== width || grab.height !== height) {
    grab.width = width;
    grab.height = height;
  }
  grabCtx.save();
  if (facing === "user") {
    grabCtx.translate(width, 0);
    grabCtx.scale(-1, 1);
  }
  grabCtx.drawImage(camera, 0, 0, width, height);
  if (mesh.width && mesh.height) grabCtx.drawImage(mesh, 0, 0, width, height);
  if (apeReady && apeCanvas.width && apeCanvas.height) {
    grabCtx.drawImage(apeCanvas, 0, 0, width, height);
  }
  grabCtx.restore();
  return true;
}

function ensureTracker() {
  if (!trackerPromise) trackerPromise = loadTracker();
  return trackerPromise;
}

async function loadTracker() {
  try {
    const vision = await import(VISION_URL);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
    faceApi = vision.FaceLandmarker;
    drawing = new vision.DrawingUtils(meshCtx);
    try {
      tracker = await createTracker(faceApi, fileset, "GPU");
    } catch {
      tracker = await createTracker(faceApi, fileset, "CPU");
    }
    return tracker;
  } catch (error) {
    trackerPromise = null;
    tracker = null;
    throw error;
  }
}

function createTracker(api, fileset, delegate) {
  return api.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: FACE_MODEL,
      delegate,
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
}

function startTracking() {
  tracking = true;
  ensureApe();
  ensureTracker()
    .then(() => {
      if (tracking && !trackFrame) trackFrame = window.requestAnimationFrame(track);
    })
    .catch(() => {
      if (tracking) {
        showNotice("Face tracking didn’t load. Check your connection, then try again.");
      }
    });
}

function stopTracking() {
  tracking = false;
  lastVideoTime = -1;
  smoothed = null;
  apeHasPose = false;
  poseFilter.ready = false;
  if (apeRig) apeRig.visible = false;
  if (trackFrame) window.cancelAnimationFrame(trackFrame);
  trackFrame = 0;
  clearMesh();
  clearApe();
}

function clearMesh() {
  if (mesh.width && mesh.height) meshCtx.clearRect(0, 0, mesh.width, mesh.height);
}

function clearApe() {
  if (apeRenderer) apeRenderer.clear();
}

function ensureApe() {
  if (!apePromise) apePromise = loadApe();
  return apePromise;
}

async function loadApe() {
  try {
    THREE = await import("three");
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    apeRenderer = new THREE.WebGLRenderer({
      canvas: apeCanvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    apeRenderer.setPixelRatio(1);
    apeRenderer.setClearColor(0x000000, 0);
    apeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    apeRenderer.toneMapping = THREE.NoToneMapping;
    apeScene = new THREE.Scene();
    apeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    apeCamera.position.set(0, 0, 1000);
    apeScene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(80, 180, 1000);
    apeScene.add(key);
    const fill = new THREE.DirectionalLight(0xfff2dc, 0.55);
    fill.position.set(-180, 40, 700);
    apeScene.add(fill);
    await showApe(apeChoice);
  } catch (error) {
    apePromise = null;
    apeReady = false;
    apeMorphs = [];
    console.error(error);
  }
}

function disposeRig(rig) {
  rig.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value && value.isTexture) value.dispose();
      });
      material.dispose();
    });
  });
}

async function showApe(name) {
  const ticket = ++apeTicket;
  apeReady = false;
  apeHasPose = false;
  shapeWeights = {};
  if (apeRig) apeRig.visible = false;
  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(APE_MODELS[name]);
    if (ticket !== apeTicket || !apeScene) return;
    if (apeRig) {
      apeScene.remove(apeRig);
      disposeRig(apeRig);
    }
    apeRig = gltf.scene;
    apeRig.visible = false;
    apeScene.add(apeRig);
    apeMorphs = collectMorphs(apeRig);
    shapeWeights = {};
    apeAnchor = apeAnchors(apeRig);
    apeReady = true;
    clearApe();
  } catch (error) {
    if (ticket === apeTicket) {
      apeReady = false;
      apeMorphs = [];
    }
    console.error(error);
  }
}

function collectMorphs(root) {
  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh && child.morphTargetDictionary && child.morphTargetInfluences) {
      meshes.push(child);
    }
  });
  return meshes;
}

const speechGain = {
  jawOpen: 3.4,
  jawForward: 2.1,
  jawLeft: 1.9,
  jawRight: 1.9,
  mouthFunnel: 3,
  mouthPucker: 3,
  mouthClose: 2.6,
  mouthRollUpper: 2.4,
  mouthRollLower: 2.4,
  mouthLeft: 2.2,
  mouthRight: 2.2,
  mouthStretchLeft: 2.1,
  mouthStretchRight: 2.1,
};

function applyFaceShapes(categories) {
  if (!apeMorphs.length) return;
  const scores = {};
  if (categories) {
    for (const category of categories) scores[category.categoryName] = category.score;
  }
  for (const mesh of apeMorphs) {
    const influences = mesh.morphTargetInfluences;
    for (const name in mesh.morphTargetDictionary) {
      const gain = speechGain[name] || 1;
      const limit = name.startsWith("mouthSmile") ? 0.62 : 1;
      const target = Math.min((scores[name] || 0) * gain, limit);
      const prev = shapeWeights[name] ?? target;
      const follow = gain > 1 ? 0.78 : 0.5;
      const next = prev + (target - prev) * follow;
      shapeWeights[name] = next;
      influences[mesh.morphTargetDictionary[name]] = next;
    }
  }
}

function centroidOf(points) {
  const center = new THREE.Vector3();
  points.forEach((point) => center.add(point));
  return center.multiplyScalar(1 / points.length);
}

function worldPoints(mesh) {
  const position = mesh.geometry.attributes.position;
  const point = new THREE.Vector3();
  const points = [];
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    mesh.localToWorld(point);
    points.push(point.clone());
  }
  return points;
}

function apeAnchors(root) {
  let eyes = null;
  let body = null;
  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (child.name === "Eyes") eyes = child;
    if (child.name === "Body") body = child;
  });
  const eyePoints = worldPoints(eyes);
  const left = eyePoints.filter((point) => point.x >= 0);
  const right = eyePoints.filter((point) => point.x < 0);
  const leftEye = centroidOf(left);
  const rightEye = centroidOf(right);
  let crown = null;
  let chin = null;
  const point = new THREE.Vector3();
  const position = body.geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    body.localToWorld(point);
    if (Math.abs(point.x) > 0.12) continue;
    if (!crown || point.y > crown.y) crown = point.clone();
    if (point.z > 0.02 && (!chin || point.y < chin.y)) chin = point.clone();
  }
  const modelX = leftEye.clone().sub(rightEye).normalize();
  const modelY = crown.clone().sub(chin);
  modelY.addScaledVector(modelX, -modelY.dot(modelX)).normalize();
  const modelZ = new THREE.Vector3().crossVectors(modelX, modelY).normalize();
  if (modelZ.z < 0) modelZ.negate();
  modelY.crossVectors(modelZ, modelX).normalize();
  return {
    mid: leftEye.clone().add(rightEye).multiplyScalar(0.5),
    span: leftEye.distanceTo(rightEye),
    x: modelX,
    y: modelY,
    z: modelZ,
  };
}

function midpoint(a, b) {
  if (!a || !b) return a || b;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function faceSamples(landmarks) {
  const refined = landmarks.length > 473;
  return {
    left: refined ? midpoint(landmarks[33], landmarks[133]) : landmarks[33],
    right: refined ? midpoint(landmarks[263], landmarks[362]) : landmarks[263],
    crown: landmarks[10],
    nose: landmarks[2] || landmarks[168],
  };
}

function faceYaw(landmarks, width, height) {
  const leftSide = midpoint(landmarks[234], landmarks[127]);
  const rightSide = midpoint(landmarks[454], landmarks[356]);
  if (!leftSide || !rightSide) return 0;
  const side = viewPoint(leftSide, width, height).sub(viewPoint(rightSide, width, height));
  const flat = Math.hypot(side.x, side.y);
  if (flat < 1e-4) return 0;
  const yaw = Math.atan2(side.z, flat);
  return Math.max(-1.15, Math.min(1.15, yaw));
}

function poseAlpha(minCutoff, beta, speed, dt) {
  const cutoff = minCutoff + beta * speed;
  const tau = 1 / (2 * Math.PI * Math.max(0.001, cutoff));
  return 1 / (1 + tau / dt);
}

function smoothPose(position, quaternion, scale) {
  const now = performance.now();
  if (!poseFilter.position) {
    poseFilter.position = position.clone();
    poseFilter.quaternion = quaternion.clone();
  }
  if (!poseFilter.ready) {
    poseFilter.time = now;
    poseFilter.position.copy(position);
    poseFilter.quaternion.copy(quaternion);
    poseFilter.scale = scale;
    poseFilter.ready = true;
    return { position: poseFilter.position, quaternion: poseFilter.quaternion, scale };
  }
  const dt = Math.min(0.1, Math.max(0.008, (now - poseFilter.time) / 1000));
  poseFilter.time = now;
  const moved = position.distanceTo(poseFilter.position);
  poseFilter.position.lerp(position, poseAlpha(0.5, 0.012, moved / dt, dt));
  const delta = poseFilter.quaternion.clone().invert().multiply(quaternion);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
  poseFilter.quaternion.slerp(quaternion, poseAlpha(0.7, 1.2, angle / dt, dt));
  const scaleAlpha = poseAlpha(0.4, 0.0008, Math.abs(scale - poseFilter.scale) / dt, dt);
  poseFilter.scale += (scale - poseFilter.scale) * scaleAlpha;
  return { position: poseFilter.position, quaternion: poseFilter.quaternion, scale: poseFilter.scale };
}

function viewPoint(landmark, width, height) {
  return new THREE.Vector3(
    (landmark.x - 0.5) * width,
    (0.5 - landmark.y) * height,
    -landmark.z * width
  );
}

function resizeApeView(width, height) {
  if (apeCanvas.width === width && apeCanvas.height === height) return;
  apeRenderer.setPixelRatio(1);
  apeRenderer.setSize(width, height, false);
  apeCamera.left = -width / 2;
  apeCamera.right = width / 2;
  apeCamera.top = height / 2;
  apeCamera.bottom = -height / 2;
  apeCamera.updateProjectionMatrix();
}

function placeApe(landmarks, width, height) {
  const samples = faceSamples(landmarks);
  if (!samples.left || !samples.right || !samples.crown || !samples.nose) return;
  resizeApeView(width, height);
  const left = viewPoint(samples.left, width, height);
  const right = viewPoint(samples.right, width, height);
  const crown = viewPoint(samples.crown, width, height);
  const noseBase = viewPoint(samples.nose, width, height);
  const userX = left.clone().sub(right);
  userX.z = 0;
  const eyeSpan = Math.hypot(samples.left.x - samples.right.x, samples.left.y - samples.right.y);
  if (userX.lengthSq() < 1e-4 || eyeSpan < 0.02) return;
  userX.normalize();
  const userY = crown.clone().sub(noseBase);
  userY.addScaledVector(userX, -userY.dot(userX));
  if (userY.lengthSq() < 1e-4) return;
  userY.normalize();
  const userZ = new THREE.Vector3().crossVectors(userX, userY).normalize();
  userY.crossVectors(userZ, userX).normalize();
  const eyeMid = left.clone().add(right).multiplyScalar(0.5);
  const nose = viewPoint(landmarks[1], width, height).sub(eyeMid);
  if (userZ.dot(nose) < 0) {
    userX.negate();
    userZ.negate();
  }

  const target = new THREE.Matrix4().makeBasis(userX, userY, userZ);
  const source = new THREE.Matrix4().makeBasis(apeAnchor.x, apeAnchor.y, apeAnchor.z);
  source.invert();
  target.multiply(source);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(target);
  const yaw = faceYaw(landmarks, width, height);
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
  const turn = Math.max(0.4, Math.abs(Math.cos(yaw)));
  const scale = (eyeSpan * width) / apeAnchor.span / turn;
  const mid = left.clone().add(right).multiplyScalar(0.5);
  const placed = apeAnchor.mid.clone().multiplyScalar(scale).applyQuaternion(quaternion);
  const position = mid.sub(placed);
  position.addScaledVector(userZ, scale * 0.035);

  const pose = smoothPose(position, quaternion, scale);
  apeRig.visible = true;
  apeRig.position.copy(pose.position);
  apeRig.quaternion.copy(pose.quaternion);
  apeRig.scale.setScalar(pose.scale);
  apeHasPose = true;
  apeRenderer.render(apeScene, apeCamera);
}

function nextStamp() {
  const now = Math.round(performance.now());
  lastStamp = now <= lastStamp ? lastStamp + 1 : now;
  return lastStamp;
}

function smoothFace(next) {
  if (!smoothed || smoothed.length !== next.length) {
    smoothed = next.map((point) => ({ x: point.x, y: point.y, z: point.z }));
    return smoothed;
  }
  const follow = 0.62;
  const keep = 1 - follow;
  for (let i = 0; i < next.length; i += 1) {
    const point = smoothed[i];
    point.x = point.x * keep + next[i].x * follow;
    point.y = point.y * keep + next[i].y * follow;
    point.z = point.z * keep + next[i].z * follow;
  }
  return smoothed;
}

function drawFaceMap(landmarks) {
  const unit = mesh.width / 390;
  const meshLine = Math.max(1, unit * 0.7);
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_TESSELATION, {
    color: "rgba(19, 66, 61, 0.4)",
    lineWidth: meshLine * 2,
  });
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_TESSELATION, {
    color: "rgba(168, 210, 114, 0.92)",
    lineWidth: meshLine,
  });
  const feature = { color: "#fdb415", lineWidth: Math.max(1.5, unit * 1.7) };
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_FACE_OVAL, feature);
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_RIGHT_EYE, feature);
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_LEFT_EYE, feature);
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_RIGHT_EYEBROW, feature);
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_LEFT_EYEBROW, feature);
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_LIPS, {
    color: "#f16a6c",
    lineWidth: feature.lineWidth,
  });
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_RIGHT_IRIS, feature);
  drawing.drawConnectors(landmarks, faceApi.FACE_LANDMARKS_LEFT_IRIS, feature);
}

function track() {
  trackFrame = 0;
  if (!tracking) return;
  paintMesh();
  if (tracking) trackFrame = window.requestAnimationFrame(track);
}

function paintMesh() {
  const width = camera.videoWidth;
  const height = camera.videoHeight;
  if (!width || !height || !tracker || !drawing || camera.readyState < 2) return;

  const resized = mesh.width !== width || mesh.height !== height;
  if (resized) {
    mesh.width = width;
    mesh.height = height;
  }
  if (!resized && camera.currentTime === lastVideoTime) return;
  lastVideoTime = camera.currentTime;

  let result;
  try {
    result = tracker.detectForVideo(camera, nextStamp());
  } catch {
    return;
  }

  meshCtx.clearRect(0, 0, width, height);
  const face = result.faceLandmarks && result.faceLandmarks[0];
  if (!face) {
    smoothed = null;
    shapeWeights = {};
    applyFaceShapes(null);
    apeHasPose = false;
    poseFilter.ready = false;
    if (apeRig) apeRig.visible = false;
    clearApe();
    return;
  }
  const points = smoothFace(face);
  const blend = result.faceBlendshapes && result.faceBlendshapes[0];
  applyFaceShapes(blend && blend.categories);
  if (apeReady) placeApe(points, width, height);
  else drawFaceMap(points);
}

function rememberCapture(blob, name) {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastBlob = blob;
  lastName = name;
  lastUrl = URL.createObjectURL(blob);
  thumb.replaceChildren();
  const img = new Image();
  img.src = lastUrl;
  img.alt = "";
  thumb.append(img);
  thumb.disabled = false;
  thumb.setAttribute("aria-label", name.endsWith(".jpg") ? "Save photo" : "Save video");
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function takePhoto() {
  if (!paintFrame()) return;
  flash.classList.remove("is-on");
  void flash.offsetWidth;
  flash.classList.add("is-on");
  grab.toBlob(
    (blob) => {
      if (blob) rememberCapture(blob, `drunkape-${stamp()}.jpg`);
    },
    "image/jpeg",
    0.92
  );
}

function pickMime() {
  const types = ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function startRecording() {
  if (!stream || typeof MediaRecorder === "undefined") {
    showNotice("This browser can’t record video.");
    return;
  }
  if (!paintFrame()) return;

  const mimeType = pickMime();
  const canvasStream = grab.captureStream(30);
  const tracks = [...canvasStream.getVideoTracks()];
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tracks.push(...audioStream.getAudioTracks());
  } catch {
    audioStream = null;
  }

  chunks = [];
  const active = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined);
  recorder = active;
  active.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  active.onstop = () => {
    const type = active.mimeType || mimeType || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const videoBlob = new Blob(chunks, { type });
    chunks = [];
    paintFrame();
    grab.toBlob(
      (still) => {
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastBlob = videoBlob;
        lastName = `drunkape-${stamp()}.${ext}`;
        lastUrl = still ? URL.createObjectURL(still) : "";
        thumb.replaceChildren();
        if (lastUrl) {
          const img = new Image();
          img.src = lastUrl;
          img.alt = "";
          thumb.append(img);
        }
        thumb.disabled = false;
        thumb.setAttribute("aria-label", "Save video");
      },
      "image/jpeg",
      0.92
    );
  };

  recording = true;
  screen.classList.add("is-recording");
  shutter.setAttribute("aria-label", "Stop recording");
  rec.hidden = false;
  recStarted = performance.now();
  recTime.textContent = "0:00";
  recTicker = window.setInterval(() => {
    recTime.textContent = formatTime(performance.now() - recStarted);
  }, 250);

  const draw = () => {
    if (!recording) return;
    paintFrame();
    drawTimer = window.requestAnimationFrame(draw);
  };
  draw();
  recorder.start();
}

function stopRecording() {
  if (!recording && !recorder) return;
  const active = recorder;
  recording = false;
  recorder = null;
  screen.classList.remove("is-recording");
  shutter.setAttribute("aria-label", mode === "photo" ? "Take photo" : "Start recording");
  rec.hidden = true;
  window.clearInterval(recTicker);
  if (drawTimer) window.cancelAnimationFrame(drawTimer);
  paintFrame();
  if (active && active.state !== "inactive") active.stop();
  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
    audioStream = null;
  }
}

async function onShutter() {
  if (shutter.disabled) return;
  if (mode === "photo") {
    takePhoto();
    return;
  }
  if (recording) stopRecording();
  else await startRecording();
}

async function saveLast() {
  if (!lastBlob) return;
  const file = new File([lastBlob], lastName, { type: lastBlob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Drunk Ape" });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(lastBlob);
  link.download = lastName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setMode(next) {
  if (next === mode) return;
  if (recording) stopRecording();
  mode = next;
  modeButtons.forEach((button) => {
    const on = button.dataset.mode === mode;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  shutter.setAttribute("aria-label", mode === "photo" ? "Take photo" : "Start recording");
}

function setApe(name) {
  apeButtons.forEach((button) => {
    const on = button.dataset.ape === name;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  if (name === apeChoice) return;
  apeChoice = name;
  if (apeScene) showApe(name);
}

shutter.addEventListener("click", onShutter);
flip.addEventListener("click", async () => {
  if (recording) stopRecording();
  facing = facing === "user" ? "environment" : "user";
  await openCamera();
});
thumb.addEventListener("click", saveLast);
retry.addEventListener("click", openCamera);
modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
apeButtons.forEach((button) => {
  button.addEventListener("click", () => setApe(button.dataset.ape));
});

window.addEventListener("resize", () => {
  show(layoutState());
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => show(layoutState()));
  window.visualViewport.addEventListener("scroll", () => {
    if (layoutState() === "app") fitScreen();
  });
}
window.addEventListener("orientationchange", () => {
  show(layoutState());
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRecording();
    stopCamera();
  } else if (layoutState() === "app") {
    openCamera();
  }
});

show(layoutState());
