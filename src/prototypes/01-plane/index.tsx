/**
 * 01-plane — full-screen pannable/zoomable 2D similarity plane.
 * People are circle cards, projects are square cards; nearby = similar.
 */
import { useEffect } from 'react';
import { DetailPanel } from './DetailPanel';
import { Hud } from './Hud';
import { MiniMap } from './MiniMap';
import { Plane } from './Plane';
import { resetPlane } from './store';
import './plane.css';

export default function Prototype() {
  // The camera + store are module singletons, so wipe them when the prototype
  // is (re)mounted from the switcher.
  useEffect(() => {
    resetPlane();
    return resetPlane;
  }, []);

  return (
    <div className="p01">
      <Plane />
      <Hud />
      <MiniMap />
      <DetailPanel />
    </div>
  );
}
