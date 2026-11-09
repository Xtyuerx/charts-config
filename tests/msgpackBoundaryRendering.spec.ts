import { expect, test } from '@playwright/test'
import { buildSync } from 'esbuild'

test('GPU clips regions and occludes rear boundaries and handles while keeping front ones visible', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<html><body></body></html>')
  const bundle = buildSync({
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    stdin: {
      resolveDir: process.cwd(),
      loader: 'ts',
      contents: `
    import * as T from 'three';
    import {BoundaryRegionColors,renderBoundaryOverlay} from './src/page/msgpackTeeth/boundaryRegionColors';
    import {ToothBoundary} from './src/page/msgpackTeeth/boundaryEditor';
    import {modelMaterial} from './src/page/msgpackTeeth/modelMaterial';
    const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(256,256);
    const target=new T.WebGLRenderTarget(256,256);renderer.setRenderTarget(target);
    const camera=new T.OrthographicCamera(-1,1,1,-1,.1,20);camera.position.z=5;camera.updateMatrixWorld();
    const scene=new T.Scene();scene.add(new T.AmbientLight(0xffffff,3));
    const tooth=new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshStandardMaterial({color:0xff0000}));scene.add(tooth);
    const gum=new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshStandardMaterial({color:0x00ff00}));
    const polygon=(right)=>[new T.Vector3(-.95,-.95,0),new T.Vector3(right,-.95,0),new T.Vector3(right,.95,0),new T.Vector3(-.95,.95,0)];
    const originalToothMaterial=tooth.material;
    const colors=new BoundaryRegionColors(new Map([[11,tooth],[0,gum]]),new Map([[11,polygon(.95)]]));
    const pixel=(x,y)=>{const p=new Uint8Array(4);renderer.readRenderTargetPixels(target,x,y,1,1,p);return [...p]};
    colors.update(11,polygon(.05));renderer.render(scene,camera);
    const inside=pixel(128,128),outside=pixel(144,128);
    const outsideOriginalContour=pixel(254,128);
    colors.update(11,polygon(.85));renderer.render(scene,camera);const localChange=pixel(243,128);
    tooth.visible=false;
    const remote=new T.Mesh(new T.PlaneGeometry(2,2).translate(0,0,.3),originalToothMaterial);scene.add(remote);
    renderer.render(scene,camera);const remoteSurface=pixel(243,128);remote.visible=false;tooth.visible=true;
    colors.update(11,polygon(.95));renderer.render(scene,camera);const reset=pixel(144,128);
    tooth.visible=false;scene.add(gum);colors.update(11,polygon(1.05));renderer.render(scene,camera);
    const gumInside=pixel(254,128),gumOutside=pixel(128,128);
    gum.visible=false;tooth.visible=true;
    const occluder=new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshBasicMaterial({color:0x111111,transparent:true,opacity:.99}));occluder.position.z=1;scene.add(occluder);
    renderer.render(scene,camera);const blocked=[pixel(128,127),pixel(128,128),pixel(32,128)];
    const overlay=new T.Scene();const b=new ToothBoundary(11,[new T.Vector3(-.75,0,-.4),new T.Vector3(.75,0,-.4),new T.Vector3(0,.5,-.4)],.025);overlay.add(b.group);
    b.select(true);renderBoundaryOverlay(renderer,scene,overlay,camera);
    const rear=[pixel(128,127),pixel(128,128),pixel(32,128)];
    b.group.position.z=2;renderBoundaryOverlay(renderer,scene,overlay,camera);
    const white=[pixel(128,127),pixel(128,128)];
    b.select(false);renderBoundaryOverlay(renderer,scene,overlay,camera);const green=[pixel(128,127),pixel(128,128)];
    const blue=pixel(32,128);
    const overlapScene=new T.Scene();overlapScene.add(new T.AmbientLight(0xffffff,3));
    const stableTooth=new T.Mesh(new T.PlaneGeometry(2,2),modelMaterial(new T.Color(0xff0000),11));
    const gumGeometry=new T.PlaneGeometry(2,2,32,32),position=gumGeometry.getAttribute('position');
    for(let i=0;i<position.count;i++) position.setZ(i,(i%2?1:-1)*.000002);
    gumGeometry.computeVertexNormals();
    const overlappingGum=new T.Mesh(gumGeometry,modelMaterial(new T.Color(0x00ff00),0));
    overlapScene.add(stableTooth,overlappingGum);renderer.render(overlapScene,camera);
    const seamPixels=[];for(let y=16;y<240;y+=8)for(let x=16;x<240;x+=8)seamPixels.push(pixel(x,y));
    window.result={inside,outside,outsideOriginalContour,localChange,remoteSurface,reset,gumInside,gumOutside,blocked,rear,white,green,blue,seamPixels};
    colors.dispose();b.dispose();target.dispose();renderer.dispose();
  `,
    },
  }).outputFiles[0]!.text
  await page.addScriptTag({ content: bundle })
  const result = await page.evaluate(() => (window as any).result)
  expect(errors).toEqual([])
  expect(result.inside[0]).toBeGreaterThan(150)
  expect(result.inside[1]).toBeLessThan(10)
  expect(result.outside[0]).toBeLessThan(10)
  expect(result.outside[1]).toBeGreaterThan(150)
  // A source tooth triangle outside the contour must no longer retain tooth color.
  expect(result.outsideOriginalContour[0]).toBeLessThan(10)
  expect(result.outsideOriginalContour[1]).toBeGreaterThan(150)
  expect(result.localChange[1]).toBeGreaterThan(150)
  expect(result.remoteSurface[0]).toBeGreaterThan(150)
  expect(result.remoteSurface[1]).toBeLessThan(10)
  expect(result.reset[0]).toBeGreaterThan(150)
  // Hiding the tooth also hides all of its derived surface color.
  expect(result.gumInside[0]).toBeLessThan(10)
  expect(result.gumInside[1]).toBeGreaterThan(150)
  expect(result.gumOutside[0]).toBeLessThan(10)
  expect(result.gumOutside[1]).toBeGreaterThan(150)
  expect(result.rear).toEqual(result.blocked)
  expect(result.white.some((p: number[]) => p[0]! > 230 && p[1]! > 230 && p[2]! > 230)).toBe(true)
  expect(result.green.some((p: number[]) => p[1]! > p[0]! + 30 && p[1]! > p[2]! + 30)).toBe(true)
  expect(result.blue[2]).toBeGreaterThan(result.blue[0] + 30)
  expect(result.seamPixels.every((p: number[]) => p[0]! > 150 && p[1]! < 10)).toBe(true)
})
