import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  Box3,
  Clock,
  DirectionalLight,
  LoopRepeat,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { AnimationAction, Group, Material, Mesh, Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { AvatarEmotion } from '../types/avatar';

interface AvatarBackgroundProps {
  mouthLevel: number;
  isSpeaking: boolean;
  activeEmotion: AvatarEmotion;
}

interface MorphBinding {
  mesh: Mesh & {
    morphTargetDictionary: Record<string, number>;
    morphTargetInfluences: number[];
  };
  index: number;
  baseInfluence: number;
}

interface JawBinding {
  bone: Object3D;
  baseRotationX: number;
}

interface ExpressionBinding {
  emotion: Exclude<AvatarEmotion, 'neutral'>;
  mesh: MorphBinding['mesh'];
  index: number;
  baseInfluence: number;
}

const FBX_MODEL_URL = `${import.meta.env.BASE_URL}avatar/avatar.fbx`;
const IDLE_ANIMATION_URL = `${import.meta.env.BASE_URL}avatar/idle.fbx`;
const TALK_ANIMATION_URL = `${import.meta.env.BASE_URL}avatar/talk.fbx`;
const MAX_MOUTH_LEVEL = 4;
const TARGET_MODEL_HEIGHT = 1.72;
const DEFAULT_VISIBLE_HEIGHT_RATIO = 0.7;
const DEFAULT_VISIBLE_WIDTH_RATIO = 0.84;
const DEFAULT_LOOK_AT_HEIGHT_RATIO = 0.64;
const DEFAULT_CAMERA_HEIGHT_OFFSET_RATIO = 0.03;
const DEFAULT_MIN_DISTANCE_RATIO = 0.72;
const DEFAULT_MAX_DISTANCE_RATIO = 1.6;
const DEFAULT_MODEL_X_OFFSET = 0.0;
const ROOT_POSITION_TRACK =
  /(^|\.)(hips|mixamorigHips|armature|root)\.position$/i;
const MOUTH_MORPH_PATTERN = /(aa|ah|aah|jaw|mouth|open|viseme|vowel|あ|ア|口)/i;
const JAW_BONE_PATTERN = /(jaw|mouth|chin|j_bip_c_jaw|下顎|口)/i;

const EXPRESSION_MORPH_PATTERNS: Record<ExpressionBinding['emotion'], RegExp> =
  {
    happy: /(happy|smile|joy|fun|laugh|grin)/i,
    sad: /(sad|sorrow|cry|frown|down)/i,
    angry: /(angry|anger|mad|rage)/i,
    surprised: /(surprise|surprised|shock|wow)/i,
    relaxed: /(relax|relaxed|calm|soft|peace)/i,
  };

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true;
}

function isMorphMesh(object: Object3D): object is MorphBinding['mesh'] {
  const mesh = object as Partial<MorphBinding['mesh']>;
  return (
    mesh.isMesh === true &&
    !!mesh.morphTargetDictionary &&
    Array.isArray(mesh.morphTargetInfluences)
  );
}

function getMaterials(material: Material | Material[]): Material[] {
  return Array.isArray(material) ? material : [material];
}

function prepareModel(root: Object3D) {
  root.traverse((object) => {
    if (!isMesh(object)) return;
    object.castShadow = true;
    object.receiveShadow = true;

    for (const material of getMaterials(object.material)) {
      material.needsUpdate = true;
    }
  });
}

function disposeObject(root: Object3D) {
  root.traverse((object) => {
    if (!isMesh(object)) return;
    object.geometry?.dispose();

    for (const material of getMaterials(object.material)) {
      material.dispose();
    }
  });
}

function collectMorphBindings(root: Object3D): MorphBinding[] {
  const bindings: MorphBinding[] = [];

  root.traverse((object) => {
    if (!isMorphMesh(object)) return;

    for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
      if (!MOUTH_MORPH_PATTERN.test(name)) continue;
      bindings.push({
        mesh: object,
        index,
        baseInfluence: object.morphTargetInfluences[index] ?? 0,
      });
    }
  });

  return bindings.slice(0, 12);
}

function collectExpressionBindings(root: Object3D): ExpressionBinding[] {
  const bindings: ExpressionBinding[] = [];

  root.traverse((object) => {
    if (!isMorphMesh(object)) return;

    for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
      if (MOUTH_MORPH_PATTERN.test(name)) continue;

      for (const [emotion, pattern] of Object.entries(
        EXPRESSION_MORPH_PATTERNS,
      ) as [ExpressionBinding['emotion'], RegExp][]) {
        if (!pattern.test(name)) continue;
        bindings.push({
          emotion,
          mesh: object,
          index,
          baseInfluence: object.morphTargetInfluences[index] ?? 0,
        });
        break;
      }
    }
  });

  return bindings.slice(0, 24);
}

function findJawBinding(root: Object3D): JawBinding | null {
  const candidates: Object3D[] = [];

  root.traverse((object) => {
    if (JAW_BONE_PATTERN.test(object.name)) {
      candidates.push(object);
    }
  });

  const jaw = candidates[0];
  return jaw ? { bone: jaw, baseRotationX: jaw.rotation.x } : null;
}

function stabilizeClip(clip: AnimationClip): AnimationClip {
  const tracks = clip.tracks.filter(
    (track) => !ROOT_POSITION_TRACK.test(track.name),
  );
  return new AnimationClip(clip.name, clip.duration, tracks);
}

function playLoopingClip(
  mixer: AnimationMixer,
  clip: AnimationClip,
  weight: number,
): AnimationAction {
  const action = mixer.clipAction(stabilizeClip(clip));
  action.reset();
  action.setLoop(LoopRepeat, Infinity);
  action.enabled = true;
  action.setEffectiveWeight(weight);
  action.play();
  return action;
}

async function loadOptionalFbx(
  loader: FBXLoader,
  url: string,
): Promise<Group | null> {
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  const header = String.fromCharCode(
    ...new Uint8Array(buffer.slice(0, Math.min(buffer.byteLength, 64))),
  );
  const isFbx =
    header.startsWith('Kaydara FBX Binary') ||
    header.includes('FBXHeaderExtension') ||
    header.includes('; FBX');

  if (!isFbx) {
    return null;
  }

  return loader.parse(buffer, '') as Group;
}

function fitModelToStage(
  root: Group,
  camera: PerspectiveCamera,
  controls: OrbitControls,
) {
  const originalBounds = new Box3().setFromObject(root);
  const originalSize = originalBounds.getSize(new Vector3());
  const scale = TARGET_MODEL_HEIGHT / Math.max(originalSize.y, 1);
  root.scale.multiplyScalar(scale);

  const bounds = new Box3().setFromObject(root);
  const center = bounds.getCenter(new Vector3());

  root.position.x += DEFAULT_MODEL_X_OFFSET - center.x;
  root.position.z -= center.z;
  root.position.y -= bounds.min.y;

  const fittedBounds = new Box3().setFromObject(root);
  const fittedSize = fittedBounds.getSize(new Vector3());
  const modelHeight = Math.max(fittedSize.y, 1.0);
  const modelWidth = Math.max(fittedSize.x, 0.6);
  const verticalFov = (camera.fov * Math.PI) / 180;
  const horizontalFov =
    2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const visibleHeight = modelHeight * DEFAULT_VISIBLE_HEIGHT_RATIO;
  const visibleWidth = modelWidth * DEFAULT_VISIBLE_WIDTH_RATIO;
  const distanceByHeight = visibleHeight / (2 * Math.tan(verticalFov / 2));
  const distanceByWidth = visibleWidth / (2 * Math.tan(horizontalFov / 2));
  const distance = Math.max(distanceByHeight, distanceByWidth);
  const lookAtY = Math.max(0.85, modelHeight * DEFAULT_LOOK_AT_HEIGHT_RATIO);
  const cameraY = lookAtY + modelHeight * DEFAULT_CAMERA_HEIGHT_OFFSET_RATIO;

  camera.position.set(DEFAULT_MODEL_X_OFFSET, cameraY, distance);
  controls.target.set(DEFAULT_MODEL_X_OFFSET, lookAtY, 0);
  controls.minDistance = Math.max(0.6, distance * DEFAULT_MIN_DISTANCE_RATIO);
  controls.maxDistance = Math.max(3.0, distance * DEFAULT_MAX_DISTANCE_RATIO);
  camera.near = 0.01;
  camera.far = Math.max(50, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

export function AvatarBackground({
  mouthLevel,
  isSpeaking,
  activeEmotion,
}: AvatarBackgroundProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetMouthWeightRef = useRef(0);
  const mouthWeightRef = useRef(0);
  const targetExpressionWeightRef = useRef(0);
  const expressionWeightRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const activeEmotionRef = useRef<AvatarEmotion>('neutral');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const targetWeight = useMemo(() => {
    if (!isSpeaking) return 0;
    const normalized = mouthLevel / MAX_MOUTH_LEVEL;
    return Math.min(Math.max(normalized, 0), 1);
  }, [isSpeaking, mouthLevel]);

  useEffect(() => {
    targetMouthWeightRef.current = targetWeight;
  }, [targetWeight]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    activeEmotionRef.current = activeEmotion;
    targetExpressionWeightRef.current =
      activeEmotion === 'neutral' ? 0 : isSpeaking ? 0.72 : 0.28;
  }, [activeEmotion, isSpeaking]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const scene = new Scene();
    const camera = new PerspectiveCamera(30, 1, 0.1, 30);
    camera.position.set(0, 1.2, 2.4);

    const ambientLight = new AmbientLight(0xffffff, 1.15);
    const keyLight = new DirectionalLight(0xffffff, 1.0);
    const rimLight = new DirectionalLight(0xd8ecff, 0.75);
    keyLight.position.set(1.2, 1.9, 1.4);
    rimLight.position.set(-1.4, 1.5, -1.2);
    scene.add(ambientLight);
    scene.add(keyLight);
    scene.add(rimLight);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      console.error('Failed to initialize WebGLRenderer:', error);
      window.setTimeout(() => {
        setLoadError('WebGL initialization failed.');
        setIsLoading(false);
      }, 0);
      return;
    }

    const rendererColorSpace = renderer as WebGLRenderer & {
      outputColorSpace?: string;
      outputEncoding?: number;
    };
    if ('outputColorSpace' in rendererColorSpace) {
      rendererColorSpace.outputColorSpace = 'srgb';
    } else if ('outputEncoding' in rendererColorSpace) {
      rendererColorSpace.outputEncoding = 3001;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.touchAction = 'none';

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;
    controls.minPolarAngle = Math.PI * 0.18;
    controls.maxPolarAngle = Math.PI * 0.58;
    controls.target.set(0, 1.1, 0);
    controls.update();

    const defaultCameraPosition = camera.position.clone();
    const defaultTarget = controls.target.clone();

    const resetCamera = () => {
      camera.position.copy(defaultCameraPosition);
      controls.target.copy(defaultTarget);
      controls.update();
    };

    const setDraggingCursor = () => {
      canvas.classList.add('is-dragging');
    };
    const clearDraggingCursor = () => {
      canvas.classList.remove('is-dragging');
    };

    canvas.addEventListener('dblclick', resetCamera);
    canvas.addEventListener('pointerdown', setDraggingCursor);
    canvas.addEventListener('pointerup', clearDraggingCursor);
    canvas.addEventListener('pointerleave', clearDraggingCursor);
    canvas.addEventListener('pointercancel', clearDraggingCursor);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let disposed = false;
    let animationFrameId = 0;
    let loadedModel: Group | null = null;
    let mixer: AnimationMixer | null = null;
    let idleAction: AnimationAction | null = null;
    let talkAction: AnimationAction | null = null;
    let morphBindings: MorphBinding[] = [];
    let expressionBindings: ExpressionBinding[] = [];
    let jawBinding: JawBinding | null = null;
    let baseModelPositionY = 0;
    let baseModelRotationY = 0;

    const loader = new FBXLoader();
    void loadOptionalFbx(loader, FBX_MODEL_URL)
      .then((model) => {
        if (disposed) return;
        if (!model) {
          setLoadError(
            'FBX model could not be loaded. Put avatar.fbx in public/avatar/.',
          );
          setIsLoading(false);
          return;
        }

        prepareModel(model);
        fitModelToStage(model, camera, controls);
        defaultCameraPosition.copy(camera.position);
        defaultTarget.copy(controls.target);

        scene.add(model);
        loadedModel = model;
        mixer = new AnimationMixer(model);
        morphBindings = collectMorphBindings(model);
        expressionBindings = collectExpressionBindings(model);
        jawBinding = findJawBinding(model);
        baseModelPositionY = model.position.y;
        baseModelRotationY = model.rotation.y;

        const bundledIdleClip = model.animations[0];
        if (bundledIdleClip && mixer) {
          idleAction = playLoopingClip(mixer, bundledIdleClip, 1);
        }

        setIsLoading(false);

        void loadOptionalFbx(loader, IDLE_ANIMATION_URL)
          .then((idleModel) => {
            if (disposed || !idleModel || !mixer) return;
            const idleClip = idleModel.animations[0];
            if (!idleClip) return;
            idleAction?.stop();
            idleAction = playLoopingClip(mixer, idleClip, 1);
          })
          .catch((error) => {
            console.warn('Failed to load optional FBX idle animation:', error);
          });

        void loadOptionalFbx(loader, TALK_ANIMATION_URL)
          .then((talkModel) => {
            if (disposed || !talkModel || !mixer) return;
            const talkClip = talkModel.animations[0];
            if (!talkClip) return;
            talkAction = playLoopingClip(mixer, talkClip, 0);
          })
          .catch((error) => {
            console.warn('Failed to load optional FBX talk animation:', error);
          });
      })
      .catch((error) => {
        if (disposed) return;
        console.error('Failed to load FBX:', error);
        setLoadError(
          'FBX model could not be loaded. Put avatar.fbx in public/avatar/.',
        );
        setIsLoading(false);
      });

    const clock = new Clock();
    const animate = () => {
      if (disposed) return;

      const delta = clock.getDelta();
      const elapsed = clock.elapsedTime;
      const nextWeight =
        mouthWeightRef.current +
        (targetMouthWeightRef.current - mouthWeightRef.current) * 0.35;
      mouthWeightRef.current = nextWeight;
      const nextExpressionWeight =
        expressionWeightRef.current +
        (targetExpressionWeightRef.current - expressionWeightRef.current) *
          0.22;
      expressionWeightRef.current = nextExpressionWeight;

      mixer?.update(delta);
      idleAction?.setEffectiveWeight(talkAction ? 1 - nextWeight * 0.28 : 1);
      talkAction?.setEffectiveWeight(nextWeight * 0.85);

      for (const binding of morphBindings) {
        binding.mesh.morphTargetInfluences[binding.index] = Math.max(
          binding.baseInfluence,
          nextWeight,
        );
      }

      for (const binding of expressionBindings) {
        const isActive = binding.emotion === activeEmotionRef.current;
        binding.mesh.morphTargetInfluences[binding.index] = Math.max(
          binding.baseInfluence,
          isActive ? nextExpressionWeight : 0,
        );
      }

      if (jawBinding) {
        jawBinding.bone.rotation.x =
          jawBinding.baseRotationX + nextWeight * 0.24;
      }

      if (loadedModel) {
        loadedModel.position.y =
          baseModelPositionY + Math.sin(elapsed * 1.25) * 0.012;
        loadedModel.rotation.y =
          baseModelRotationY +
          Math.sin(elapsed * 0.7) * 0.024 +
          (isSpeakingRef.current ? Math.sin(elapsed * 6.0) * 0.01 : 0);
      }

      controls.update();
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();

      if (loadedModel) {
        scene.remove(loadedModel);
        disposeObject(loadedModel);
      }
      canvas.removeEventListener('dblclick', resetCamera);
      canvas.removeEventListener('pointerdown', setDraggingCursor);
      canvas.removeEventListener('pointerup', clearDraggingCursor);
      canvas.removeEventListener('pointerleave', clearDraggingCursor);
      canvas.removeEventListener('pointercancel', clearDraggingCursor);
      controls.dispose();
      mixer?.stopAllAction();
      if (mixer && loadedModel) {
        mixer.uncacheRoot(loadedModel);
      }
      morphBindings = [];
      expressionBindings = [];
      jawBinding = null;
      mouthWeightRef.current = 0;
      targetMouthWeightRef.current = 0;
      expressionWeightRef.current = 0;
      targetExpressionWeightRef.current = 0;
      renderer.dispose();
    };
  }, []);

  return (
    <div className="avatar-background">
      <div className="vrm-stage" ref={containerRef}>
        <canvas ref={canvasRef} className="vrm-canvas" />
        {isLoading && !loadError && (
          <div className="avatar-status">Loading FBX avatar...</div>
        )}
        {!isLoading && !loadError && (
          <div className="avatar-status avatar-guide">
            Drag: rotate / Wheel: zoom / Double-click: reset
          </div>
        )}
        {loadError && <div className="avatar-error">{loadError}</div>}
      </div>
    </div>
  );
}
