// Visualizador GLB 2.0 local do ArtiSys Oficina. Nenhum CDN ou conta externa.
// Importações dinâmicas somente quando o usuário abre um modelo instalado.
let active=null;

function paintable(id,mesh){
  const material=String(mesh.material?.name||'').toLowerCase();
  const chain=[];let node=mesh;
  for(let i=0;i<4&&node;i++,node=node.parent)chain.push((node.name||'').toLowerCase());
  const nodeNames=chain.join(' ');
  if(id==='fiat-uno')return /\b(capo|porta_malas|chassis\.001|chassis\.004|spoiler|caixa)\b/.test(nodeNames);
  if(id==='fiat-palio')return /^g\d+m1(?:\.001)?$/.test(material)||/body|carroceria/i.test(nodeNames);
  if(id==='ford-ka'||id==='vw-fox')return material==='am5eunew1';
  if(id==='chevrolet-corsa')return /^(bootok|chassis003|doorrfok|mala007|part)\w*mtl$/i.test(material);
  return false;
}

export async function mountViewer({id,variant='original',element,statusElement}){
  active?.dispose();
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)||!['original','restored','repaired'].includes(variant))
    throw new Error('Modelo 3D inválido');
  if(!element?.isConnected)throw new Error('Janela 3D não disponível');
  if(statusElement)statusElement.textContent='Carregando modelo 3D local...';
  const request=await fetch('/api/models3d/file/'+id+'/'+variant,{credentials:'same-origin',cache:'no-store'});
  if(!request.ok){
    let err='Arquivo 3D ainda não instalado';
    try{err=(await request.json()).error||err}catch{}
    throw new Error(err);
  }
  const buffer=await request.arrayBuffer();
  if(!element.isConnected)return null;
  const [THREE,loaderModule,controlsModule,meshopt]=await Promise.all([
    import('/vendor/three/three.module.js'),
    import('/vendor/three/addons/loaders/GLTFLoader.js'),
    import('/vendor/three/addons/controls/OrbitControls.js'),
    import('/vendor/meshopt_decoder.mjs')
  ]);
  await meshopt.MeshoptDecoder.ready;
  if(!element.isConnected)return null;
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=0.92;
  renderer.setClearColor(0xe2eae6,1);
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x8c9f97,1.75));
  const light=new THREE.DirectionalLight(0xffffff,2.05);light.position.set(5,9,8);scene.add(light);
  const fill=new THREE.DirectionalLight(0xbdd9de,0.9);fill.position.set(-5,4,-7);scene.add(fill);
  const camera=new THREE.PerspectiveCamera(39,1,0.01,100000);
  const controls=new controlsModule.OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.07;
  controls.enablePan=false;
  controls.minDistance=0.1;
  controls.maxPolarAngle=Math.PI*.88;
  controls.minPolarAngle=Math.PI*.12;
  const loader=new loaderModule.GLTFLoader();
  loader.setMeshoptDecoder(meshopt.MeshoptDecoder);
  let gltf=null;
  const originalMaterials=new Map();
  let disposed=false,raf=0,resizeObserver=null,mutationObserver=null;
  const cleanup=()=>{
    if(disposed)return;
    disposed=true;
    cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    controls.dispose();
    if(gltf)gltf.scene.traverse(obj=>{
      if(!obj.isMesh)return;
      obj.geometry?.dispose();
      const mats=Array.isArray(obj.material)?obj.material:[obj.material];
      mats.forEach(m=>{
        if(!m)return;
        for(const key of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'])
          m[key]?.dispose?.();
        m.dispose?.();
      });
    });
    renderer.dispose();
    renderer.domElement.remove();
    if(active?.dispose===cleanup)active=null;
  };
  active={dispose:cleanup};
  try{
    gltf=await new Promise((resolve,reject)=>loader.parse(buffer,'',resolve,reject));
    if(disposed||!element.isConnected){cleanup();return null}
    scene.add(gltf.scene);
    const box=new THREE.Box3().setFromObject(gltf.scene);
    if(box.isEmpty())throw new Error('O GLB não contém geometria visível');
    const size=box.getSize(new THREE.Vector3());
    const center=box.getCenter(new THREE.Vector3());
    const radius=Math.max(size.length()*.5,.08);
    const distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*1.20;
    camera.position.copy(center).add(new THREE.Vector3(1.45,.68,1.55).normalize().multiplyScalar(distance));
    camera.near=Math.max(.0001,distance-radius*3.2);
    camera.far=Math.max(100,distance+radius*12);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance=Math.max(radius*.65,.01);
    controls.maxDistance=distance*3;
    controls.update();
    element.replaceChildren(renderer.domElement);
    const resize=()=>{
      if(disposed)return;
      const width=Math.max(element.clientWidth,240);
      const height=Math.max(element.clientHeight,260);
      renderer.setSize(width,height,false);
      camera.aspect=width/height;
      camera.updateProjectionMatrix();
    };
    resizeObserver=new ResizeObserver(resize);resizeObserver.observe(element);resize();
    const loop=()=>{
      if(disposed)return;
      if(!element.isConnected||element.closest('#modal')?.classList.contains('hidden')){cleanup();return}
      controls.update();renderer.render(scene,camera);
      raf=requestAnimationFrame(loop);
    };
    mutationObserver=new MutationObserver(()=>{
      if(!element.isConnected||element.closest('#modal')?.classList.contains('hidden'))cleanup();
    });
    mutationObserver.observe(document.querySelector('#modal')||document.body,{attributes:true,subtree:true,childList:true});
    loop();
    if(statusElement)statusElement.textContent='Arraste para girar · Pince para ampliar · Visualização experimental';
    return {
      dispose:cleanup,
      paint(hex){
        if(disposed||!/^#[0-9a-fA-F]{6}$/.test(hex))return;
        gltf.scene.traverse(obj=>{
          if(!obj.isMesh||!paintable(id,obj))return;
          if(!originalMaterials.has(obj)){
            const clone=material=>material.clone();
            obj.material=Array.isArray(obj.material)?obj.material.map(clone):clone(obj.material);
            originalMaterials.set(obj,true);
          }
          const mats=Array.isArray(obj.material)?obj.material:[obj.material];
          mats.forEach(mat=>{if(mat?.color){mat.color.set(hex);mat.needsUpdate=true}});
        });
      }
    };
  }catch(error){cleanup();throw error}
}

export function closeViewer(){active?.dispose()}
