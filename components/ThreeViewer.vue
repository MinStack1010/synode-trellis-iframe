<template>
    <div ref="viewport" class="glb-viewport">
        <div v-if="!modelUrl" class="viewer-empty d-flex flex-column align-center">
            <span class="viewer-cube">◇</span>
            <strong>{{ $t("image3d.viewerTitle") }}</strong>
            <p>{{ $t("image3d.viewerText") }}</p>
        </div>
        <div class="viewer-status"><span></span>{{ modelUrl ? $t("image3d.glbLoaded") : $t("image3d.viewerReady") }}</div>
        <div class="stage-hint">{{ $t("image3d.hint") }}</div>
    </div>
</template>

<script>
export default {
    name: "ThreeViewer",
    props: { modelUrl: { type: String, default: "" } },
    data() { return { renderer: null, scene: null, camera: null, controls: null, frame: null }; },
    mounted() { this.initialize(); },
    beforeDestroy()
    {
        cancelAnimationFrame(this.frame);
        window.removeEventListener("resize", this.resize);
        this.renderer?.dispose();
    },
    watch: { modelUrl(url) { if (url) this.loadModel(url); } },
    methods: {
        async initialize()
        {
            const THREE = await import("three");
            const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
            this.THREE = THREE;
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color("#f5f6f7");
            this.camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
            this.camera.position.set(2.8, 2.1, 3.4);
            this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.shadowMap.enabled = true;
            this.$refs.viewport.prepend(this.renderer.domElement);
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.target.set(0, .45, 0);
            this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d96a0, 2.4));
            const light = new THREE.DirectionalLight(0xffffff, 3);
            light.position.set(4, 6, 3); light.castShadow = true; this.scene.add(light);
            const grid = new THREE.GridHelper(10, 20, 0xd4d8dc, 0xe7e9eb);
            this.scene.add(grid);
            this.resize(); window.addEventListener("resize", this.resize);
            if (this.modelUrl) this.loadModel(this.modelUrl);
            const render = () => { this.frame = requestAnimationFrame(render); this.controls.update(); this.renderer.render(this.scene, this.camera); };
            render();
        },
        resize()
        {
            if (!this.renderer) return;
            const { width, height } = this.$refs.viewport.getBoundingClientRect();
            this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height);
        },
        async loadModel(url)
        {
            if (!this.THREE) return;
            const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
            const gltf = await new GLTFLoader().loadAsync(url);
            this.model?.removeFromParent(); this.model = gltf.scene; this.scene.add(this.model);
        }
    }
};
</script>
