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
import pako from "pako";

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

const flipPixelsUint8Y = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const flippedPixels = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y += 1) {
    const offsetY = y * width * 4;
    const flippedOffsetY = (height - y - 1) * width * 4;
    flippedPixels.set(
      pixels.subarray(offsetY, offsetY + width * 4),
      flippedOffsetY
    );
  }
  return flippedPixels;
};

const flipPixelsFloat32Y = (
  pixels: Float32Array,
  width: number,
  height: number
) => {
  const flippedPixels = new Float32Array(pixels.length);
  for (let y = 0; y < height; y += 1) {
    const offsetY = y * width * 4;
    const flippedOffsetY = (height - y - 1) * width * 4;
    flippedPixels.set(
      pixels.subarray(offsetY, offsetY + width * 4),
      flippedOffsetY
    );
  }
  return flippedPixels;
};

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
    lightMapSize: 4096,
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

    // this.directionalLight = new DirectionalLight(0xffffff, 1);

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
    this.lightTranformController.addEventListener("mouseUp", () => {
      console.log("mouseUp");
      this.lightmapper.render();
    });
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
      max: 8192,
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
        // console.log(this.lightDummy.position);

        this.generateLightmap();

        // const group: Group = this.scene.getObjectByName("group");
        // console.log("group: ", group);
        // group.traverse((child: Mesh) => {
        //   if (child.isMesh) {
        //     console.log(`child: ${child.name}`);
        //     console.log(child.geometry.getAttribute("uv2"));
        //   }
        // });

        // this.lightmapper.render();
        // this.options.pause = true;

        // Todo: Not sure why need this in a timeout...
        setTimeout(() => {
          this.lightmapper.render();
          this.options.pause = true;
          // console.log("position texture: ", this.positionTexture.texture);
          // console.log("normal texture: ", this.normalTexture.texture);
          // console.log("lightmap texture: ", this.lightmapTexture.texture);
          // console.log("lightmap render target: ", this.lightmapTexture);
        }, 0);
      });
    this.pane
      .addButton({
        title: "Lightmap render",
      })
      .on("click", () => {
        this.lightmapper.render();
      });
    this.pane
      .addButton({
        title: "Save lightmap",
      })
      .on("click", () => {
        const canvas = document.createElement("canvas");
        canvas.width = this.lightmapTexture.width;
        canvas.height = this.lightmapTexture.height;

        const pixels = new Float32Array(
          this.lightmapTexture.width * this.lightmapTexture.height * 4
        );
        this.renderer.readRenderTargetPixels(
          this.lightmapTexture,
          0,
          0,
          this.lightmapTexture.width,
          this.lightmapTexture.height,
          pixels
        );
        // console.log("pixels: ", pixels);

        const pixelsUint = new Uint8ClampedArray(pixels.length);
        this.lightmapTexture.width, this.lightmapTexture.height;
        for (let i = 0; i < pixels.length; i += 1) {
          pixelsUint[i] = Math.round(pixels[i] * 255);
        }
        const imageData = new ImageData(
          flipPixelsUint8Y(
            pixelsUint,
            this.lightmapTexture.width,
            this.lightmapTexture.height
          ),
          this.lightmapTexture.width,
          this.lightmapTexture.height
        );
        const context = canvas.getContext("2d");
        context.putImageData(imageData, 0, 0);
        context.scale(1, -1);
        context.drawImage(canvas, 0, 0);
        const dataURL = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = dataURL;
        link.download = "lightmap.png";
        link.click();
      });
    this.pane
      .addButton({
        title: "Save position texture png",
      })
      .on("click", () => {
        const canvas = document.createElement("canvas");
        canvas.width = this.positionTexture.width;
        canvas.height = this.positionTexture.height;

        const pixels = new Float32Array(
          this.positionTexture.width * this.positionTexture.height * 4
        );
        this.renderer.readRenderTargetPixels(
          this.positionTexture,
          0,
          0,
          this.positionTexture.width,
          this.positionTexture.height,
          pixels
        );

        const pixelsUint = new Uint8ClampedArray(pixels.length);
        this.positionTexture.width, this.positionTexture.height;
        for (let i = 0; i < pixels.length; i += 1) {
          pixelsUint[i] = Math.round(pixels[i] * 255);
        }
        const imageData = new ImageData(
          flipPixelsUint8Y(
            pixelsUint,
            this.positionTexture.width,
            this.positionTexture.height
          ),
          this.positionTexture.width,
          this.positionTexture.height
        );
        const context = canvas.getContext("2d");
        context.putImageData(imageData, 0, 0);
        context.scale(1, -1);
        context.drawImage(canvas, 0, 0);
        const dataURL = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = dataURL;
        link.download = "position.png";
        link.click();
      });
    this.pane
      .addButton({
        title: "Save position",
      })
      .on("click", () => {
        const canvas = document.createElement("canvas");
        canvas.width = this.positionTexture.width;
        canvas.height = this.positionTexture.height;

        const pixels = new Float32Array(
          this.positionTexture.width * this.positionTexture.height * 4
        );
        this.renderer.readRenderTargetPixels(
          this.positionTexture,
          0,
          0,
          this.positionTexture.width,
          this.positionTexture.height,
          pixels
        );
        const pixelsFlipped = flipPixelsFloat32Y(
          pixels,
          this.positionTexture.width,
          this.positionTexture.height
        );

        const pixelsFlippedUint8 = new Uint8Array(pixelsFlipped.buffer);
        console.log(pixelsFlippedUint8.length);
        console.log(pixelsFlipped.buffer.byteLength);
        console.log(pixelsFlippedUint8.buffer.byteLength);
        const pixelsFlippedUint8Deflated = pako.deflate(pixelsFlippedUint8);

        const blob = new Blob([pixelsFlippedUint8Deflated], {
          type: "application/octet-stream",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = "position.bin";
        link.href = url;
        link.click();
      });
    this.pane
      .addButton({
        title: "Show shadow poly",
      })
      .on("click", () => {
        const canvas = document.createElement("canvas");
        canvas.width = this.positionTexture.width;
        canvas.height = this.positionTexture.height;

        const pixels = new Float32Array(
          this.positionTexture.width * this.positionTexture.height * 4
        );
        this.renderer.readRenderTargetPixels(
          this.positionTexture,
          0,
          0,
          this.positionTexture.width,
          this.positionTexture.height,
          pixels
        );
        const pixelsFlipped = flipPixelsFloat32Y(
          pixels,
          this.positionTexture.width,
          this.positionTexture.height
        );
        const arbitraryPixelCoords = [
          [3797, 1954],
          [3798, 1954],
          [3797, 1959],
          [3747, 2099],
          [3669, 2063],
          [3675, 2030],
          [3797, 1954],
        ];

        const getValueAt = (row: number, col: number) => {
          const index = row * this.positionTexture.width * 4 + col * 4;
          return pixelsFlipped.slice(index, index + 4);
        };
        // const colRow = [3714, 2952];
        // console.log(
        //   `row ${colRow[1]}, col ${colRow[0]}`,
        //   getValueAt(colRow[1], colRow[0])
        // );
        const arbitShadowVec3s = arbitraryPixelCoords.map((coord) => {
          const value = getValueAt(coord[1], coord[0]);
          return new Vector3(value[0], value[1], value[2]);
        });
        const arbitShadowGeom = getPolygonGeometryFromVector3s(
          arbitShadowVec3s,
          0.001
        );
        const shadowMaterial = new MeshBasicMaterial({ color: 0x00ff00 });
        const arbitShadowMesh = new Mesh(arbitShadowGeom, shadowMaterial);
        this.scene.add(arbitShadowMesh);

        const quadPixelCoords = [
          [3903, 3055],
          [3903, 3158],
          [3966, 3158],
          [3966, 3055],
          [3903, 3055],
        ];
        const quadShadowVec3s = quadPixelCoords.map((coord) => {
          const value = getValueAt(coord[1], coord[0]);
          return new Vector3(value[0], value[1], value[2]);
        });
        const quadShadowGeom = getPolygonGeometryFromVector3s(
          quadShadowVec3s,
          0.001
        );
        const quadShadowMesh = new Mesh(quadShadowGeom, shadowMaterial);
        this.scene.add(quadShadowMesh);

        const triPixelCoords = [
          [3824, 1563],
          [3827, 1563],
          [3827, 1640],
          [3763, 1665],
          [3743, 1596],
          [3824, 1563],
        ];
        const triShadowVec3s = triPixelCoords.map((coord) => {
          const value = getValueAt(coord[1], coord[0]);
          return new Vector3(value[0], value[1], value[2]);
        });
        const triShadowGeom = getPolygonGeometryFromVector3s(
          triShadowVec3s,
          0.001
        );
        const triShadowMesh = new Mesh(triShadowGeom, shadowMaterial);
        this.scene.add(triShadowMesh);
      });
    this.pane
      .addButton({
        title: "Save attributes",
      })
      .on("click", () => {
        const group: Group = this.scene.getObjectByName("group");
        console.log("group: ", group);
        const attributes = {};
        group.traverse((child: Mesh) => {
          if (child.isMesh) {
            console.log(`child: ${child.name}`);
            console.log(child.geometry.getAttribute("uv2"));
            attributes[child.name] = {
              attributes: child.geometry.attributes,
              index: child.geometry.index,
            };
          }
        });
        console.log("attributes: ", JSON.stringify(attributes));
        const blob = new Blob([JSON.stringify(attributes)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = "attributes.json";
        link.href = url;
        link.click();
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
    currGroup.name = "group";

    const groundVec3s = [
      new Vector3(-10, 0, -10),
      new Vector3(-10, 0, 10),
      new Vector3(10, 0, 10),
      new Vector3(10, 0, -10),
    ];
    const groundGeom = getPolygonGeometryFromVector3s(groundVec3s, 0);
    groundGeom.computeVertexNormals();
    const ground = new Mesh(
      groundGeom,
      new MeshStandardMaterial({ color: 0xaaaaaa })
    );
    ground.name = "ground";
    this.currentModelMeshs.push(ground);
    currGroup.add(ground);

    // const plane = new Mesh(
    //   new PlaneGeometry(20, 20),
    //   new MeshBasicMaterial({ color: 0xaaaaaa })
    // );
    // plane.rotation.x = -Math.PI / 2;
    // plane.name = "ground";
    // this.currentModelMeshs.push(plane);
    // currGroup.add(plane);
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

    // const shadowPos = new Mesh(
    //   new BoxGeometry(0.1, 0.1, 0.1),
    //   new MeshBasicMaterial({ color: 0x00ff00 })
    // );
    // shadowPos.position.set(0, 0, -1.5);
    // this.scene.add(shadowPos);

    const triVec3s = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0.5, 1, -1),
    ];
    const triGeom = getPolygonGeometryFromVector3s(triVec3s, 0);
    triGeom.computeVertexNormals();
    const triMat = new MeshBasicMaterial({ color: 0x0000ff });
    const triMesh = new Mesh(triGeom, triMat);
    triMesh.name = "triangle";
    triMesh.translateZ(-1);
    this.currentModelMeshs.push(triMesh);
    currGroup.add(triMesh);
    // this.scene.add(triMesh);

    const quadVec3s = [
      new Vector3(0, 0, -1),
      new Vector3(-1, 0, -1),
      new Vector3(-1, 1, -2),
      new Vector3(0, 1, -2),
    ];
    const quadGeom = getPolygonGeometryFromVector3s(quadVec3s, 0);
    quadGeom.computeVertexNormals();
    const quadMat = new MeshStandardMaterial({ color: 0x0000ff });
    const quadMesh = new Mesh(quadGeom, quadMat);
    quadMesh.name = "quad";
    // quadMesh.translateZ(-1);
    this.currentModelMeshs.push(quadMesh);
    currGroup.add(quadMesh);
    // this.scene.add(quadMesh);

    const arbitraryVec3s = [
      // new Vector3(1.16, 0, 4.96),
      // new Vector3(4.02, 0, 5.76),
      new Vector3(6.84, 0, 4.4),
      new Vector3(5.3, 0, 2.44),
      new Vector3(6.1, 0, 1),
      new Vector3(2.84, 0, 0.5),
      new Vector3(1, 0, 2),
    ];
    const arbitraryVec2s = arbitraryVec3s.map(
      (vec3) => new Vector2(vec3.x, vec3.z)
    );
    const arbitraryShape = new Shape(arbitraryVec2s);
    const arbitraryGeom = BufferGeometryUtils.BufferGeometryUtils.mergeVertices(
      new ExtrudeGeometry(arbitraryShape, {
        depth: height / 2,
        steps: 1,
        bevelEnabled: false,
      })
    );
    const arbitraryMesh = new Mesh(
      arbitraryGeom,
      new MeshStandardMaterial({ color: 0xffff00 })
    );
    arbitraryMesh.translateZ(-1.5);
    arbitraryMesh.translateX(-3);
    arbitraryMesh.rotateX(-Math.PI / 2);
    arbitraryMesh.name = "arbitrary";

    // const arbitraryGeom = getPolygonGeometryFromVector3s(arbitraryVec3s, 0.5);
    // arbitraryGeom.computeVertexNormals();
    // const arbitraryMat = new MeshStandardMaterial({ color: 0xffff00 });
    // const arbitraryMesh = new Mesh(arbitraryGeom, arbitraryMat);
    // arbitraryMesh.translateZ(-7.5);
    // arbitraryMesh.translateX(-3);
    // arbitraryMesh.name = "arbitrary";

    this.currentModelMeshs.push(arbitraryMesh);
    currGroup.add(arbitraryMesh);
    // this.scene.add(arbitraryMesh);

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

    // this.update();

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
    }, 0);
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

    // if (this.lightmapper && !this.options.pause) {
    //   this.lightmapper.render();
    // }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
