import {
  sRGBEncoding,
  Color,
  DirectionalLight,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  BoxGeometry,
  PlaneGeometry,
  Scene,
  Group,
  Texture,
  Vector2,
  Vector3,
  ShapeUtils,
  BufferGeometry,
  BufferAttribute,
  ExtrudeGeometry,
  Shape,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import { Pane } from "tweakpane";
import { generateAtlas } from "./atlas/generateAtlas";
import { renderAtlas } from "./atlas/renderAtlas";
import {
  generateLightmapper as generateLightmapper,
  Lightmapper,
  RaycastOptions,
} from "./lightmap/Lightmapper";
import { mergeGeometry } from "./utils/GeometryUtils";
import { LoadGLTF } from "./utils/LoaderUtils";

const models = {
  ["level_blockout.glb"]: "level_blockout.glb",
};

const buildingCoords = [
  [-0.5, -0.5],
  [-0.5, 0.5],
  [0.5, 0.5],
  [0.5, -0.5],
];

const parapetCoords = [
  [
    [-0.5, -0.5],
    [-0.5, 0.5],
  ],
  [
    [-0.5, 0.5],
    [0.5, 0.5],
  ],
  [
    [0.5, 0.5],
    [0.5, -0.5],
  ],
  [
    [0.5, -0.5],
    [-0.5, -0.5],
  ],
];

const getPolygonGeometryFromVector3s = (
  vector3s: Vector3[],
  offset: number
) => {
  const bufferVertices = [];
  for (let i = 0; i < vector3s.length; i += 1) {
    const vertex = vector3s[i];
    bufferVertices.push(vertex.x, vertex.y + offset, vertex.z);
  }

  const triangulatedIndex = ShapeUtils.triangulateShape(
    vector3s.map((vector3) => new Vector2(vector3.x, vector3.z)),
    []
  )
    .flat()
    .reverse();

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(bufferVertices), 3)
  );
  geometry.setIndex(triangulatedIndex);
  return geometry;
};

const renderMode = {
  Standard: "standard",
  Positions: "positions",
  Normals: "normals",
  "UV2 Debug": "uv",
  Lightmap: "lightmap",
  Beauty: "beauty",
};

const Filter = {
  LinearFilter: "linear",
  Nearest: "nearest",
};

export class LightBakerExample {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  scene: Scene;
  controls: OrbitControls;
  directionalLight: DirectionalLight;

  lightDummy: Object3D;
  lightTranformController: TransformControls;

  currentModel: Object3D;
  currentModelMeshs: Mesh[] = [];

  uvDebugTexture: Texture;
  positionTexture: WebGLRenderTarget;
  normalTexture: WebGLRenderTarget;
  lightmapTexture: WebGLRenderTarget;

  debugPosition: Mesh;
  debugNormals: Mesh;
  debugLightmap: Mesh;

  lightmapper: Lightmapper | null;

  pane: Pane;

  options = {
    model: "level_blockout",
    renderMode: "beauty",
    lightMapSize: 1024,
    casts: 1,
    filterMode: "linear",
    directLightEnabled: true,
    indirectLightEnabled: false,
    ambientLightEnabled: false,
    ambientDistance: 0.3,
    debugTextures: true,
    pause: false,
  };

  constructor(uvDebugTexture: Texture) {
    this.uvDebugTexture = uvDebugTexture;

    this.scene = new Scene();
    this.scene.background = new Color(0x74b9ff);

    this.camera = new PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 10, 10);

    this.renderer = new WebGLRenderer({
      antialias: true,
    });
    this.renderer.outputEncoding = sRGBEncoding;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    this.directionalLight = new DirectionalLight(0xffffff, 1);

    this.lightDummy = new Object3D();
    this.lightDummy.position.copy(new Vector3(0, 1, 1).normalize());

    this.lightTranformController = new TransformControls(
      this.camera,
      this.renderer.domElement
    );
    this.lightTranformController.addEventListener(
      "dragging-changed",
      (event) => {
        this.controls.enabled = !event.value;
      }
    );
    this.lightTranformController.attach(this.lightDummy);
    this.scene.add(this.lightDummy);
    this.scene.add(this.lightTranformController);

    this.pane = new Pane();
    this.pane
      .addInput(this.options, "model", {
        options: models,
      })
      .on("change", () => this.onMapChange());
    this.pane
      .addInput(this.options, "renderMode", {
        options: renderMode,
      })
      .on("change", () => this.onRenderModeChange());

    this.pane.addInput(this.options, "lightMapSize", {
      max: 4096,
      min: 128,
      step: 128,
    });

    this.pane.addInput(this.options, "casts", {
      max: 4,
      min: 1,
      step: 1,
    });

    this.pane.addInput(this.options, "directLightEnabled");
    this.pane.addInput(this.options, "indirectLightEnabled");
    this.pane.addInput(this.options, "ambientLightEnabled");
    this.pane.addInput(this.options, "ambientDistance", {
      max: 2,
      min: 0.01,
    });

    this.pane
      .addInput(this.options, "debugTextures")
      .on("change", () => this.onRenderModeChange());

    this.pane
      .addInput(this.options, "filterMode", {
        options: Filter,
      })
      .on("change", () => this.onRenderModeChange());

    this.pane
      .addButton({
        title: "Reset",
      })
      .on("click", () => {
        this.options.pause = false;
        this.pane.refresh();
        console.log(this.lightDummy.position);

        this.generateLightmap();

        // Todo: Not sure why need this in a timeout...
        setTimeout(() => {
          this.lightmapper.render();
        }, 0);
      });

    this.pane.addInput(this.options, "pause");

    this.initialSetup();
  }

  updateSize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  async initialSetup() {
    await this.onMapChange();
  }

  async onMapChange() {
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
    }

    this.camera.position.set(0, 5, 5);

    this.currentModelMeshs = [];

    this.lightmapper = null;

    // const gltf = await LoadGLTF(this.options.model);

    // gltf.scene.traverse((child: any) => {
    //   if (child.isMesh) {
    //     child.material._originalMap = child.material.map;
    //     this.currentModelMeshs.push(child);
    //   }
    // });

    // this.currentModel = gltf.scene;
    // this.scene.add(gltf.scene);

    // console.log("currentModelMeshes: ", this.currentModelMeshs);

    const currGroup = new Group();

    const plane = new Mesh(
      new PlaneGeometry(20, 20),
      new MeshBasicMaterial({ color: 0xaaaaaa })
    );
    plane.rotation.x = -Math.PI / 2;
    this.currentModelMeshs.push(plane);
    currGroup.add(plane);
    // this.scene.add(plane);

    // const cube = new Mesh(
    //   new BoxGeometry(1, 1, 1),
    //   new MeshBasicMaterial({ color: 0xffffff })
    // );
    // cube.position.set(0, 0.5, 0);
    // // cube.material._originalMap = cube.material.map;
    // // this.scene.add(cube);
    // this.currentModelMeshs.push(cube);
    // currGroup.add(cube);

    const height = 1;
    const buildingVec2 = buildingCoords.map((coord) => new Vector2(...coord));
    const buildingShape = new Shape(buildingVec2);
    const buildingGeom = BufferGeometryUtils.BufferGeometryUtils.mergeVertices(
      new ExtrudeGeometry(buildingShape, {
        depth: height,
        steps: 1,
        bevelEnabled: false,
      })
    );
    const buildingMat = new MeshStandardMaterial({ color: 0xffffff });
    const buildingMesh = new Mesh(buildingGeom, buildingMat);
    buildingMesh.rotateX(-Math.PI / 2);
    buildingMesh.name = "building";
    // buildingMesh.castShadow = true;
    this.currentModelMeshs.push(buildingMesh);
    currGroup.add(buildingMesh);
    // this.scene.add(buildingMesh);

    const shadowPos = new Mesh(
      new BoxGeometry(0.1, 0.1, 0.1),
      new MeshBasicMaterial({ color: 0x00ff00 })
    );
    shadowPos.position.set(0, 0, -1.5);
    this.scene.add(shadowPos);

    const triVec3s = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0.5, 1, -1),
    ];
    const triGeom = getPolygonGeometryFromVector3s(triVec3s, 0);
    triGeom.computeVertexNormals();
    const triMat = new MeshBasicMaterial({ color: 0x0000ff });
    const triMesh = new Mesh(triGeom, triMat);
    triMesh.translateZ(-1);
    this.currentModelMeshs.push(triMesh);
    currGroup.add(triMesh);
    // this.scene.add(triMesh);

    const quadVec3s = [
      new Vector3(0, 0, 0),
      new Vector3(-1, 0, 0),
      new Vector3(-1, 1, -1),
      new Vector3(0, 1, -1),
    ];
    const quadGeom = getPolygonGeometryFromVector3s(quadVec3s, 0);
    quadGeom.computeVertexNormals();
    const quadMat = new MeshStandardMaterial({ color: 0x0000ff });
    const quadMesh = new Mesh(quadGeom, quadMat);
    quadMesh.translateZ(-1);
    this.currentModelMeshs.push(quadMesh);
    currGroup.add(quadMesh);
    // this.scene.add(quadMesh);

    // const cube2 = new Mesh(
    //   new BoxGeometry(0.5, 4, 0.5),
    //   new MeshBasicMaterial({ color: 0xffffff })
    // );
    // cube2.position.set(2, 2, 1.5);
    // // this.scene.add(cube2);
    // this.currentModelMeshs.push(cube2);
    // currGroup.add(cube2);

    this.scene.add(currGroup);
    this.currentModel = currGroup;
    console.log("currentModelMeshes: ", this.currentModelMeshs);

    await this.updateAtlasTextures();

    this.update();

    await this.generateLightmap();

    // Render once to get the lightmap
    this.lightmapper.render();
  }

  async updateAtlasTextures() {
    await generateAtlas(this.currentModelMeshs);
  }

  async generateLightmap() {
    const resolution = this.options.lightMapSize;

    const atlas = renderAtlas(
      this.renderer,
      this.currentModelMeshs,
      resolution,
      true
    );
    this.positionTexture = atlas.positionTexture;
    this.normalTexture = atlas.normalTexture;

    this.update();

    const mergedGeomerty = mergeGeometry(this.currentModelMeshs);
    const bvh = new MeshBVH(mergedGeomerty);

    const lightmapperOptions: RaycastOptions = {
      resolution: resolution,
      casts: this.options.casts,
      filterMode:
        this.options.filterMode == "linear" ? LinearFilter : NearestFilter,
      lightPosition: this.lightDummy.position,
      lightSize: 1,
      ambientDistance: this.options.ambientDistance,
      ambientLightEnabled: this.options.ambientLightEnabled,
      directLightEnabled: this.options.directLightEnabled,
      indirectLightEnabled: this.options.indirectLightEnabled,
    };

    this.lightmapper = await generateLightmapper(
      this.renderer,
      atlas.positionTexture.texture,
      atlas.normalTexture.texture,
      bvh,
      lightmapperOptions
    );
    this.lightmapTexture = this.lightmapper.renderTexture;

    this.onRenderModeChange();

    // Auto-pause
    setTimeout(() => {
      this.options.pause = true;
      this.pane.refresh();
    }, 2000);
  }

  createDebugTexture(texture: Texture, position: Vector3) {
    const debugTexture = new Mesh(
      new PlaneGeometry(20, 20),
      new MeshBasicMaterial({
        map: texture,
        side: DoubleSide,
      })
    );

    debugTexture.position.copy(position);
    debugTexture.scale.set(0.5, 0.5, 0.5);

    this.scene.add(debugTexture);

    return debugTexture;
  }

  onDebugTexturesChange() {
    if (this.debugPosition) {
      this.scene.remove(this.debugPosition);
    }

    if (this.debugNormals) {
      this.scene.remove(this.debugNormals);
    }

    if (this.debugLightmap) {
      this.scene.remove(this.debugLightmap);
    }

    if (this.options.debugTextures) {
      this.debugPosition = this.createDebugTexture(
        this.positionTexture.texture,
        new Vector3(0, 10, 0)
      );
      this.debugNormals = this.createDebugTexture(
        this.normalTexture.texture,
        new Vector3(12, 10, 0)
      );
      this.debugLightmap = this.createDebugTexture(
        this.lightmapTexture,
        new Vector3(24, 10, 0)
      );
    }
  }

  onRenderModeChange() {
    this.currentModel.traverse((child: any) => {
      if (child.isMesh) {
        // child.material = new MeshBasicMaterial();
        child.material.map = null;

        if (this.options.renderMode == "standard") {
          child.material.lightMap = null;
          child.material.map = child.material._originalMap;
        }

        if (this.options.renderMode == "positions") {
          child.material.lightMap = this.positionTexture;
        }

        if (this.options.renderMode == "normals") {
          child.material.lightMap = this.normalTexture;
        }

        if (this.options.renderMode == "uv") {
          child.material.lightMap = this.uvDebugTexture;
        }

        if (this.options.renderMode == "lightmap") {
          child.material.lightMap = this.lightmapTexture;
        }

        if (this.options.renderMode == "beauty") {
          child.material.lightMap = this.lightmapTexture;
          child.material.map = child.material._originalMap;
        }

        if (child.material.lightMap) {
          child.material.lightMap.needsUpdate = true;
        }

        child.material.lightMapIntensity = 1;
        child.material.needsUpdate = true;
      }
    });

    if (this.options.renderMode == "standard") {
      this.scene.add(this.directionalLight);
    } else {
      this.scene.remove(this.directionalLight);
    }

    this.onDebugTexturesChange();
  }

  update() {
    requestAnimationFrame(() => this.update());

    if (this.lightmapper && !this.options.pause) {
      this.lightmapper.render();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
