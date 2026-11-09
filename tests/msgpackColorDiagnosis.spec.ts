import { expect, test } from '@playwright/test'
import { buildSync } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'

test('preview gum color matches original gum until surface normals change the lighting', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<html><body style="margin:0;background:#edf1f7"></body></html>')
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
        import {modelMaterial} from './src/page/msgpackTeeth/modelMaterial';
        import {BoundaryRegionColors} from './src/page/msgpackTeeth/boundaryRegionColors';
        const renderer = new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
        renderer.setSize(480,240);renderer.setClearColor('#edf1f7');
        const target = new T.WebGLRenderTarget(480,240);
        const scene = new T.Scene();
        const camera = new T.OrthographicCamera(-1.2,1.2,.6,-.6,.1,20);
        camera.position.z=5;camera.updateMatrixWorld();
        const tooth=new T.Mesh(new T.PlaneGeometry(1,1),modelMaterial(new T.Color('#ff8ad4'),11));
        const gum=new T.Mesh(new T.PlaneGeometry(1,1),modelMaterial(new T.Color('#d391a0'),0));
        tooth.position.x=-.6;gum.position.x=.6;scene.add(tooth,gum);
        const hemi=new T.HemisphereLight(0xffffff,0x718099,2.4);
        const light=new T.DirectionalLight(0xffffff,3);light.position.set(1,-2,4);scene.add(hemi,light);
        const polygon=(right)=>[new T.Vector3(-.49,-.49,0),new T.Vector3(right,-.49,0),new T.Vector3(right,.49,0),new T.Vector3(-.49,.49,0)];
        const colors=new BoundaryRegionColors(new Map([[11,tooth],[0,gum]]),new Map([[11,polygon(.49)]]));
        colors.update(11,polygon(-.25));
        const capture=(title)=>{
          renderer.setRenderTarget(target);renderer.render(scene,camera);
          const read=(x)=>{const p=new Uint8Array(4);renderer.readRenderTargetPixels(target,x,120,1,1,p);return [...p].slice(0,3)};
          const result={recoloredTooth:read(120),originalGum:read(360)};
          renderer.setRenderTarget(null);renderer.render(scene,camera);
          const section=document.createElement('section');section.style.cssText='display:inline-block;vertical-align:top;width:480px;font:16px sans-serif;margin:8px';
          const text=document.createElement('p');text.textContent=title;section.append(text);
          const image=document.createElement('img');image.src=renderer.domElement.toDataURL();section.append(image);document.body.append(section);
          return result;
        };
        const sameNormals=capture('法线一致（左：改色牙面；右：原牙龈）');
        const normals=tooth.geometry.getAttribute('normal');
        const tilted=new T.Vector3(0,.8,.6);
        for(let i=0;i<normals.count;i++)normals.setXYZ(i,tilted.x,tilted.y,tilted.z);
        normals.needsUpdate=true;
        const differentNormals=capture('法线不同（底色保持一致）');
        scene.remove(hemi,light);scene.add(new T.AmbientLight(0xffffff,3));
        const ambientOnly=capture('法线不同，仅环境光');
        window.diagnosis={sameNormals,differentNormals,ambientOnly};
        colors.dispose();target.dispose();renderer.dispose();
      `,
    },
  }).outputFiles[0]!.text
  await page.setViewportSize({ width: 1500, height: 340 })
  await page.addScriptTag({ content: bundle })
  const result = await page.evaluate(() => (window as any).diagnosis)
  expect(errors).toEqual([])
  const difference = (sample: { recoloredTooth: number[]; originalGum: number[] }) =>
    Math.max(...sample.recoloredTooth.map((n, i) => Math.abs(n - sample.originalGum[i]!)))
  expect(difference(result.sameNormals)).toBeLessThanOrEqual(1)
  expect(difference(result.differentNormals)).toBeGreaterThan(10)
  expect(difference(result.ambientOnly)).toBeLessThanOrEqual(1)
  mkdirSync('outputs/msgpack-color-diagnosis', { recursive: true })
  writeFileSync('outputs/msgpack-color-diagnosis/result.json', JSON.stringify(result, null, 2))
  await page.screenshot({ path: 'outputs/msgpack-color-diagnosis/comparison.png', fullPage: true })
})
