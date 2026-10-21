import * as THREE from 'three';

/**
 * Fixed isometric camera: 45deg yaw, ~41deg pitch, orthographic.
 * The 13x13-tile plaza is 26 world units across; its diamond silhouette is
 * ~26*sqrt2 wide and ~26*sin(pitch) tall on screen, so the vertical frustum
 * needs ~31 units to keep the whole square framed with a little margin.
 */
export const FRUSTUM_HEIGHT = 27;
export function createIsoCamera(aspect: number): THREE.OrthographicCamera {
  const frustum = FRUSTUM_HEIGHT;
  const cam = new THREE.OrthographicCamera(
    (-frustum * aspect) / 2,
    (frustum * aspect) / 2,
    frustum / 2,
    -frustum / 2,
    0.1,
    200,
  );
  cam.position.set(26, 30, 26);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}
