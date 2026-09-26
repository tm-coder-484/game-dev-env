// Assets are shared with the Godot project so both engines use the same CC0
// HDRI, PBR textures and Blender-generated models. Vite fingerprints and
// copies anything referenced via `new URL('<literal path>', import.meta.url)`
// into dist/ - keep the paths as string literals so Vite can see them.
export const ASSETS = {
  sky: new URL('../../godot/assets/shared/hdri/sky.hdr', import.meta.url).href,
  ground: {
    color: new URL('../../godot/assets/shared/textures/ground/diff.jpg', import.meta.url).href,
    normal: new URL('../../godot/assets/shared/textures/ground/nor_gl.jpg', import.meta.url).href,
    roughness: new URL('../../godot/assets/shared/textures/ground/rough.jpg', import.meta.url).href,
  },
  rock: new URL('../../godot/assets/shared/models/rock.glb', import.meta.url).href,
};
