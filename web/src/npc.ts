import * as THREE from 'three';

/**
 * An NPC whose lines are written live by an LLM via OpenRouter.
 * The browser never sees your API key: requests go to tools/openrouter/server.mjs
 * (`make ai-server`), which adds OPENROUTER_API_KEY server-side.
 * Point it elsewhere with ?ai=https://your-server/chat
 */
const AI_URL = new URLSearchParams(location.search).get('ai') ?? 'http://127.0.0.1:8787/chat';
const PERSONA =
  'You are Mara, a weathered ranger who watches over this valley. Answer in one or two short ' +
  'sentences, in character, with concrete details about the valley. Never mention being an AI.';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

export class Npc {
  readonly mesh: THREE.Mesh;
  private readonly bubble = document.getElementById('bubble')!;
  private readonly history: Msg[] = [];
  private busy = false;
  private text = 'Mara  [E] talk';

  constructor(position: THREE.Vector3) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x38554a, roughness: 0.85 });
    this.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.15, 8, 16), mat);
    this.mesh.position.copy(position).add(new THREE.Vector3(0, 0.875, 0));
    this.mesh.castShadow = this.mesh.receiveShadow = true;
  }

  update(playerPos: THREE.Vector3, camera: THREE.Camera, talkPressed: boolean): void {
    const near = playerPos.distanceTo(this.mesh.position) < 3.2;
    if (near && talkPressed && !this.busy) void this.talk();

    const head = this.mesh.position.clone().add(new THREE.Vector3(0, 1.3, 0)).project(camera);
    const visible = (near || this.busy) && head.z < 1;
    this.bubble.style.display = visible ? 'block' : 'none';
    if (visible) {
      this.bubble.style.left = `${(head.x * 0.5 + 0.5) * innerWidth}px`;
      this.bubble.style.top = `${(-head.y * 0.5 + 0.5) * innerHeight}px`;
      this.bubble.textContent = this.text;
    }
  }

  private async talk(): Promise<void> {
    this.busy = true;
    this.text = '…';
    this.history.push({
      role: 'user',
      content: this.history.length ? '(The traveller asks you to tell them more.)' : '(A traveller walks up and greets you.)',
    });
    try {
      const res = await fetch(AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'system', content: PERSONA }, ...this.history.slice(-8)], max_tokens: 150 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { reply } = (await res.json()) as { reply: string };
      this.history.push({ role: 'assistant', content: reply });
      this.text = reply;
    } catch (err) {
      this.history.pop();
      this.text = `[AI offline: ${(err as Error).message}] Run \`make ai-server\` with OPENROUTER_API_KEY set.`;
    } finally {
      this.busy = false;
    }
  }
}
