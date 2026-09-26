import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

type Rapier = typeof RAPIER;

/** First-person controller: Rapier kinematic character + pointer-lock mouse look. */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly flashlight: THREE.SpotLight;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private vy = 0;
  private grounded = false;
  private bob = 0;
  // Stats shown on the HUD: sprinting drains stamina, hard landings cost health.
  readonly maxHealth = 100;
  readonly maxStamina = 100;
  health = 100;
  stamina = 100;
  private regenDelay = 0;
  private exhausted = false;
  private fallSpeed = 0;

  static readonly EYE = 1.65;
  static readonly HALF_HEIGHT = 0.55;
  static readonly RADIUS = 0.35;

  constructor(rapier: Rapier, world: RAPIER.World, spawn: THREE.Vector3, dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 800);
    this.flashlight = new THREE.SpotLight(0xfff4e0, 60, 25, THREE.MathUtils.degToRad(28), 0.4, 1.5);
    this.flashlight.visible = false;
    this.flashlight.castShadow = true;
    this.flashlight.position.set(0.2, -0.15, 0);
    this.flashlight.target.position.set(0.2, -0.15, -1);
    this.camera.add(this.flashlight, this.flashlight.target);

    const centerY = Player.HALF_HEIGHT + Player.RADIUS;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + centerY, spawn.z),
    );
    this.collider = world.createCollider(rapier.ColliderDesc.capsule(Player.HALF_HEIGHT, Player.RADIUS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(50));
    this.controller.setApplyImpulsesToDynamicBodies(true);

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.flashlight.visible = !this.flashlight.visible;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0025, -1.55, 1.55);
    });
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  pressed(code: string): boolean {
    return this.keys.has(code);
  }

  /** Returns whether the player may sprint this frame. */
  private updateStamina(dt: number, wantsSprint: boolean): boolean {
    const sprinting = wantsSprint && !this.exhausted && this.grounded;
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - 22 * dt);
      this.regenDelay = 0.8;
      this.exhausted = this.stamina <= 0;
    } else if (this.regenDelay > 0) {
      this.regenDelay -= dt;
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + 16 * dt);
      if (this.exhausted && this.stamina > this.maxStamina * 0.25) this.exhausted = false;
    }
    return sprinting;
  }

  update(dt: number): void {
    const forward = Number(this.pressed('KeyW') || this.pressed('ArrowUp')) - Number(this.pressed('KeyS') || this.pressed('ArrowDown'));
    const strafe = Number(this.pressed('KeyD') || this.pressed('ArrowRight')) - Number(this.pressed('KeyA') || this.pressed('ArrowLeft'));
    const moving = forward !== 0 || strafe !== 0;
    const sprinting = this.updateStamina(dt, moving && (this.pressed('ShiftLeft') || this.pressed('ShiftRight')));
    const speed = sprinting ? 8 : 4.5;

    const move = new THREE.Vector3(strafe, 0, -forward);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
    move.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    if (this.grounded) {
      this.vy = this.pressed('Space') ? 4.8 : -0.5;
    } else {
      this.vy -= 9.8 * dt;
    }
    move.y = this.vy * dt;

    const wasAirborne = !this.grounded;
    this.fallSpeed = wasAirborne ? Math.max(this.fallSpeed, -this.vy) : 0;
    this.controller.computeColliderMovement(this.collider, move);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (wasAirborne && this.grounded && this.fallSpeed > 9) {
      this.health = Math.max(0, this.health - (this.fallSpeed - 9) * 8);
    }
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });

    const horizontal = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
    this.bob = this.grounded && horizontal > 0.5 ? this.bob + dt * horizontal * 1.6 : this.bob * 0.9;
    const feet = t.y - Player.HALF_HEIGHT - Player.RADIUS;
    this.camera.position.set(t.x + m.x, feet + m.y + Player.EYE + Math.sin(this.bob * 2) * 0.04, t.z + m.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
