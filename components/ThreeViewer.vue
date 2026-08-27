<template>
	<div ref="viewport" class="glb-viewport">
		<div v-if="!modelUrl && !isLoading" class="viewer-empty d-flex flex-column align-center">
			<span>
				<img src="/logo/synodeLogo.png" alt="Synode" />
			</span>
			<strong>{{ $t("image3d.viewerTitle") }}</strong>
			<p>{{ $t("image3d.viewerText") }}</p>
		</div>

		<transition name="loader-fade">
			<div v-if="isLoading" class="synode-loader-overlay">
				<div class="synode-loader-content">
					<div class="synode-loader-logo">
						<img src="/logo/synodeLogo.png" alt="Synode" class="synode-icon" aria-hidden="true" />
					</div>

					<div class="synode-loader-bar-wrap">
						<div class="synode-loader-bar" :class="{ 'is-queued': queuePosition !== null }" :style="{ width: progressWidth }"></div>
					</div>

					<p class="synode-loader-label">
						{{ loadingLabel }}
					</p>
				</div>
			</div>
		</transition>

		<div class="viewer-status">
			<span></span>{{ modelUrl ? $t("image3d.glbLoaded") : $t("image3d.viewerReady") }}
		</div>
	</div>
</template>

<script>
export default {
	name: "ThreeViewer",
	props: {
		modelUrl: { type: String, default: "" },
		generating: { type: Boolean, default: false },
		progress: { type: Number, default: 0 },
		queuePosition: { type: Number, default: null }
	},
	data() {
		return {
			renderer: null, scene: null, camera: null, controls: null, frame: null,
			loadingModel: false
		};
	},
	computed: {
		isLoading() { return this.generating || this.loadingModel; },
		progressWidth() {
			if (this.loadingModel) return "95%";
			if (this.queuePosition !== null) return "8%";
			if (this.progress > 0) return `${Math.min(Math.max(this.progress, 5), 94)}%`;
			return "20%";
		},
		loadingLabel() {
			if (this.loadingModel) return this.$t("image3d.loadingModel") || "Loading model…";
			if (this.queuePosition !== null) {
				if (this.queuePosition === 1) {
					return this.$t("image3d.queuePositionNext") || "You're next — starting shortly…";
				}
				return this.$t("image3d.queuePosition", { position: this.queuePosition })
					|| `You're #${this.queuePosition} in the queue…`;
			}
			const pct = this.progress > 0 ? ` (${Math.round(this.progress)}%)` : "";
			return (this.$t("image3d.generating") || "Generating 3D model…") + pct;
		}
	},
	mounted() { this.initialize(); },
	beforeDestroy() {
		cancelAnimationFrame(this.frame);
		window.removeEventListener("resize", this.resize);
		this.renderer?.dispose();
	},
	watch: {
		modelUrl(url) {
			if (!this.THREE) {
				this._pendingModelUrl = url || null;
				return;
			}
			if (url) this.loadModel(url);
			else this.clearModel();
		}
	},
	methods: {
		/** Expose THREE library for export functions */
		getThree() {
			return this.THREE;
		},
		
		/** Expose the loaded model for export functions */
		getModel() {
			return this.model;
		},
		
		async initialize() {
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
			grid.position.y = -0.001;
			this.scene.add(grid);
			this.resize(); window.addEventListener("resize", this.resize);

			const urlToLoad = this._pendingModelUrl !== undefined ? this._pendingModelUrl : this.modelUrl;
			if (urlToLoad) this.loadModel(urlToLoad);
			this._pendingModelUrl = undefined;

			const render = () => {
				this.frame = requestAnimationFrame(render);
				this.controls.update();
				this.renderer.render(this.scene, this.camera);
			};
			render();
		},
		resize() {
			if (!this.renderer) return;
			const { width, height } = this.$refs.viewport.getBoundingClientRect();
			this.camera.aspect = width / height;
			this.camera.updateProjectionMatrix();
			this.renderer.setSize(width, height);
		},
		async loadModel(url) {
			if (!this.THREE) return;
			this.loadingModel = true;
			try {
				const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
				const gltf = await new GLTFLoader().loadAsync(url);
				this.clearModel();
				this.model = gltf.scene;
				
				// Debug materials in loaded model
				console.log('[ThreeViewer] Model loaded, checking materials...');
				this.model.traverse(node => {
					if (node.isMesh) {
						console.log('[ThreeViewer] Mesh:', node.name, 'has material:', !!node.material);
						if (node.material) {
							console.log('[ThreeViewer] Material type:', node.material.type);
							console.log('[ThreeViewer] Material color:', node.material.color);
							console.log('[ThreeViewer] Material maps:', {
								map: node.material.map,
								normalMap: node.material.normalMap,
								roughnessMap: node.material.roughnessMap,
								metalnessMap: node.material.metalnessMap
							});
						}
					}
				});
				
				this.placeOnGround(this.model);
				this.scene.add(this.model);
				this.frameModel(this.model);
			} finally {
				this.loadingModel = false;
			}
		},
		clearModel() {
			if (!this.model) return;
			this.model.traverse((node) => {
				if (!node.isMesh) return;
				node.geometry?.dispose();
				const materials = Array.isArray(node.material) ? node.material : [node.material];
				materials.filter(Boolean).forEach((m) => m.dispose());
			});
			this.model.removeFromParent();
			this.model = null;
		},
		placeOnGround(model) {
			const box = new this.THREE.Box3().setFromObject(model);
			if (!box.isEmpty()) model.position.y -= box.min.y;
		},
		/**
		 * Returns the currently loaded model (THREE.Object3D) or null.
		 * Used by parent components to drive USDZ / FBX export.
		 */
		getModel() {
			return this.model || null;
		},

		/**
		 * Returns the loaded THREE namespace.
		 * Allows exporters to call THREE.Vector3 etc. without re-importing.
		 */
		getThree() {
			return this.THREE || null;
		},

		frameModel(model) {
			const box = new this.THREE.Box3().setFromObject(model);
			if (box.isEmpty()) return;
			const center = box.getCenter(new this.THREE.Vector3());
			const size = box.getSize(new this.THREE.Vector3());
			const maxDimension = Math.max(size.x, size.y, size.z, 0.01);
			const distance = (maxDimension / (2 * Math.tan(this.THREE.MathUtils.degToRad(this.camera.fov / 2)))) * 1.4;
			this.controls.target.copy(center);
			this.camera.position.set(center.x + distance, center.y + distance * 0.65, center.z + distance);
			this.camera.near = Math.max(distance / 100, 0.001);
			this.camera.far = distance * 100;
			this.camera.updateProjectionMatrix();
			this.controls.update();
		}
	}
};
</script>


