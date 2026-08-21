<template>
	<main class="trellis-app">
		<app-header />
		<v-container fluid class="workspace pa-0">
			<v-row no-gutters class="workspace-row">
				<v-col cols="12" lg="3" xl="3" class="control-column d-flex">
					<aside class="control-panel w-100 pa-4 pa-md-6">
						<div class="eyebrow">
							{{ $t("image3d.eyebrow") }}
						</div>

						<h1 class="mt-1 mb-2">
							{{ $t("image3d.title") }}
						</h1>

						<!-- <p class="intro mb-5">
							{{ $t("image3d.description") }}
						</p> -->

						<image-upload @changed="onImageChanged" />

						<v-divider class="my-5" />

						<div class="generation-title d-flex align-center justify-space-between">
							<h2>{{ $t("image3d.generation") }}</h2>
							<!-- <span>TRELLIS.2 · 4B</span> -->
						</div>

						<div
							class="segmented mt-3 mb-2"
							role="group"
							:aria-label="$t('image3d.outputResolution')"
						>
							<v-btn
								v-for="item in resolutions"
								:key="item"
								elevation="0"
								:class="{
									'resolution-selected': resolution === item
								}"
								@click="resolution = item"
							>
								{{ item }}²
							</v-btn>
						</div>

						<v-row dense class="form-grid ma-0">
							<v-col cols="12" sm="6" class="pa-1">
								<v-text-field
									v-model="seed"
									outlined
									dense
									hide-details
									:label="$t('image3d.seed')"
									inputmode="numeric"
								/>
							</v-col>

							<v-col cols="12" sm="6" class="pa-1">
								<v-select
									v-model="texture"
									outlined
									dense
									hide-details
									:label="$t('image3d.textureSize')"
									:items="textureOptions"
								/>
							</v-col>

							<v-col cols="12" sm="6" class="pa-1">
								<v-select
									v-model="decimationTarget"
									outlined
									dense
									hide-details
									:label="$t('image3d.glbTarget')"
									:items="decimationOptions"
								/>
							</v-col>

							<v-col cols="12" sm="6" class="pa-1">
								<v-select
									v-model="output"
									outlined
									dense
									hide-details
									:label="$t('image3d.output')"
									:items="outputOptions"
								/>
							</v-col>
						</v-row>

						<v-checkbox
							v-model="randomizeSeed"
							class="check mt-2 mb-3"
							dense
							hide-details
							:label="$t('image3d.randomize')"
						/>

						<v-btn
							type="button"
							outlined
							block
							height="48"
							class="advanced"
							:class="{ configured: settingsApplied }"
							@click="advancedOpen = true"
						>
							<span>
								{{ $t("image3d.advanced") }}

								<small v-if="settingsApplied">
									{{ $t("image3d.applied") }}
								</small>
							</span>

							<v-spacer />

							<b>+</b>
						</v-btn>

						<v-btn
							type="button"
							block
							height="52"
							class="generate mt-3"
							:disabled="!hasImage || generating"
							@click="generate"
						>
							<span v-if="generating" class="btn-spinner" aria-hidden="true" />
							{{
								generating
									? `${$t("image3d.generating")} ${jobProgress > 0 ? `(${Math.round(jobProgress)}%)` : ''}`
									: $t("image3d.generate")
							}}
						</v-btn>
					</aside>
				</v-col>

				<v-col cols="12" lg="9" xl="9" class="preview-column d-flex">
					<section class="preview-panel w-100">
						<v-row
							no-gutters
							class="preview-toolbar align-center justify-end px-4 py-3 px-md-6 py-md-3"
						>
							<v-col
								cols="auto"
								class="tool-actions-column"
							>
								<div class="tool-actions d-flex">
									<!-- Export menu -->
									<div class="menu-wrap">
										<v-btn
											type="button"
											class="export"
											:aria-expanded="exportOpen.toString()"
											aria-controls="export-menu"
											@click="toggleMenu('export')"
										>
											{{ $t("image3d.export") }}
											<svg class="menu-chevron" :class="{ 'is-open': exportOpen }" viewBox="0 0 24 24" aria-hidden="true">
												<path d="m7 10 5 5 5-5" />
											</svg>
										</v-btn>

										<transition name="menu">
											<div v-if="exportOpen" id="export-menu" class="action-menu" role="menu">
												<v-btn type="button" :disabled="!generated" role="menuitem" @click="downloadGlb">
													{{ $t("image3d.exportGlb") }}
												</v-btn>
												<div class="menu-item-wrap">
													<v-btn type="button" disabled role="menuitem" class="menu-item-disabled">
														{{ $t("image3d.exportFbx") }}
														<span class="coming-soon">{{ $t("image3d.comingSoon") }}</span>
													</v-btn>
												</div>
												<div class="menu-item-wrap">
													<v-btn type="button" disabled role="menuitem" class="menu-item-disabled">
														{{ $t("image3d.exportUsdz") }}
														<span class="coming-soon">{{ $t("image3d.comingSoon") }}</span>
													</v-btn>
												</div>
											</div>
										</transition>
									</div>

									<!-- Publish menu -->
									<div class="menu-wrap">
										<v-btn
											type="button"
											class="publish"
											:aria-expanded="publishOpen.toString()"
											aria-controls="publish-menu"
											@click="toggleMenu('publish')"
										>
											{{ $t("image3d.publish") }}
											<svg class="menu-chevron" :class="{ 'is-open': publishOpen }" viewBox="0 0 24 24" aria-hidden="true">
												<path d="m7 10 5 5 5-5" />
											</svg>
										</v-btn>

										<transition name="menu">
											<div v-if="publishOpen" id="publish-menu" class="action-menu" role="menu">
												<div class="menu-item-wrap">
													<v-btn type="button" disabled role="menuitem" class="menu-item-disabled">
														{{ $t("image3d.publishToLibrary") }}
														<span class="coming-soon">{{ $t("image3d.comingSoon") }}</span>
													</v-btn>
												</div>
												<div class="menu-item-wrap">
													<v-btn type="button" disabled role="menuitem" class="menu-item-disabled">
														{{ $t("image3d.sendToVisualizer") }}
														<span class="coming-soon">{{ $t("image3d.comingSoon") }}</span>
													</v-btn>
												</div>
												<div class="menu-item-wrap">
													<v-btn type="button" disabled role="menuitem" class="menu-item-disabled">
														{{ $t("image3d.sendToBuilder") }}
														<span class="coming-soon">{{ $t("image3d.comingSoon") }}</span>
													</v-btn>
												</div>
											</div>
										</transition>
									</div>
								</div>
							</v-col>
						</v-row>

						<three-viewer
							:model-url="modelUrl"
							:generating="generating"
							:progress="jobProgress"
						/>
					</section>
				</v-col>
			</v-row>
		</v-container>

		<div
			v-if="advancedOpen"
			class="modal-backdrop"
			@click.self="advancedOpen = false"
		>
			<section
				class="advanced-modal d-flex flex-column"
				role="dialog"
				aria-modal="true"
				:aria-label="$t('image3d.advanced')"
			>
				<header class="d-flex align-start justify-space-between">
					<div>
						<!-- <span class="eyebrow">TRELLIS.2 · 4B</span> -->

						<h2>
							{{ $t("image3d.advanced") }}
						</h2>
					</div>

					<v-btn
						icon
						type="button"
						:aria-label="$t('image3d.close')"
						@click="advancedOpen = false"
					>
						×
					</v-btn>
				</header>

				<div class="advanced-content">
					<div
						v-for="stage in advancedStages"
						:key="stage.name"
						class="advanced-stage"
					>
						<h3>
							{{ $t(stage.name) }}
						</h3>

						<div class="advanced-grid">
							<v-text-field
								v-for="field in stage.fields"
								:key="field.key"
								v-model.number="advanced[field.key]"
								outlined
								dense
								hide-details
								type="number"
								:label="$t(field.label)"
								:min="field.min"
								:max="field.max"
								:step="field.step"
							/>
						</div>
					</div>
				</div>

				<footer class="d-flex justify-end">
					<v-btn
						type="button"
						class="secondary"
						@click="advancedOpen = false"
					>
						{{ $t("image3d.cancel") }}
					</v-btn>

					<v-btn
						type="button"
						class="generate"
						@click="applySettings"
					>
						{{ $t("image3d.applySettings") }}
					</v-btn>
				</footer>
			</section>
		</div>

		<transition name="toast">
			<div
				v-if="toastMessage"
				class="app-toast d-flex align-center"
				:class="{ 'app-toast--error': toastType === 'error' }"
				:role="toastType === 'error' ? 'alert' : 'status'"
			>
				<span aria-hidden="true">{{ toastType === 'error' ? '✕' : '✓' }}</span>
				{{ toastMessage }}
			</div>
		</transition>
	</main>
</template>

<script>
import AppHeader from "~/components/AppHeader.vue";
import ImageUpload from "~/components/ImageUpload.vue";
import ThreeViewer from "~/components/ThreeViewer.vue";

export default {
	name: "ImageTo3DPage",
	components: { AppHeader, ImageUpload, ThreeViewer },
	data() {
			return {
						hasImage: false, selectedFile: null, generating: false, generated: false, seed: "284739", texture: 2048, decimationTarget: 500000, output: "PBR mesh · GLB", resolution: "1024", resolutions: ["512", "1024", "1536"], textureOptions: [{ text: "1024 px", value: 1024 }, { text: "2048 px", value: 2048 }, { text: "4096 px", value: 4096 }], decimationOptions: [{ text: this.$t("image3d.faces", { count: "250,000" }), value: 250000 }, { text: this.$t("image3d.faces", { count: "500,000" }), value: 500000 }, { text: this.$t("image3d.faces", { count: "1,000,000" }), value: 1000000 }], outputOptions: ["PBR mesh · GLB"], randomizeSeed: false,
				advancedOpen: false, exportOpen: false, publishOpen: false, modelUrl: "", settingsApplied: false, toastMessage: "", toastType: "success", toastTimer: null,
				jobId: null, jobProgress: 0, jobMessage: "",
				advanced: { sparseGuidance: 7.5, sparseRescale: .7, sparseSteps: 12, sparseT: 5, shapeGuidance: 7.5, shapeRescale: .5, shapeSteps: 12, shapeT: 3, materialGuidance: 1, materialRescale: 0, materialSteps: 12, materialT: 3 },
				advancedStages: [
					{ name: "image3d.stages.sparse", fields: [{ key: "sparseGuidance", label: "image3d.fields.guidance", min: 1, max: 10, step: .1 }, { key: "sparseRescale", label: "image3d.fields.guidanceRescale", min: 0, max: 1, step: .01 }, { key: "sparseSteps", label: "image3d.fields.samplingSteps", min: 1, max: 50, step: 1 }, { key: "sparseT", label: "image3d.fields.rescaleT", min: 1, max: 6, step: .1 }] },
					{ name: "image3d.stages.shape", fields: [{ key: "shapeGuidance", label: "image3d.fields.guidance", min: 1, max: 10, step: .1 }, { key: "shapeRescale", label: "image3d.fields.guidanceRescale", min: 0, max: 1, step: .01 }, { key: "shapeSteps", label: "image3d.fields.samplingSteps", min: 1, max: 50, step: 1 }, { key: "shapeT", label: "image3d.fields.rescaleT", min: 1, max: 6, step: .1 }] },
					{ name: "image3d.stages.material", fields: [{ key: "materialGuidance", label: "image3d.fields.guidance", min: 1, max: 10, step: .1 }, { key: "materialRescale", label: "image3d.fields.guidanceRescale", min: 0, max: 1, step: .01 }, { key: "materialSteps", label: "image3d.fields.samplingSteps", min: 1, max: 50, step: 1 }, { key: "materialT", label: "image3d.fields.rescaleT", min: 1, max: 6, step: .1 }] }
				]
			};
	},
	methods: {
		onImageChanged(file) {
			this.selectedFile = file;
			this.hasImage = Boolean(file);
		},
		openExtract() {
			// "Extract GLB" tab — nếu đã có model thì download thẳng luôn
			if (this.generated) this.downloadGlb();
		},
		toggleMenu(menu) {
			const isOpen = menu === "export" ? this.exportOpen : this.publishOpen;
			this.exportOpen = menu === "export" && !isOpen;
			this.publishOpen = menu === "publish" && !isOpen;
		},
		async generate() {
			if (!this.selectedFile) return;
			const apiUrl = (process.env.trellisApiUrl || "").replace(/\/$/, "");
			if (!apiUrl) {
			this.showToast(this.$t("image3d.apiNotConfigured"), "error");
				return;
			}

			this.generating = true;
			this.generated = false;
			this.jobProgress = 0;
			this.jobMessage = "";
			if (this.randomizeSeed) this.seed = Math.floor(Math.random() * 4294967295).toString();

			try {
				// Create job
				const response = await fetch(`${apiUrl}/generate`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						image: await this.fileToBase64(this.selectedFile),
						seed: Number(this.seed) || 0,
						pipeline_type: this.resolution === "512" ? "512" : `${this.resolution}_cascade`,
						decimation_target: this.decimationTarget,
						texture_size: this.texture,
						ss_guidance_strength: this.advanced.sparseGuidance,
						ss_guidance_rescale: this.advanced.sparseRescale,
						ss_sampling_steps: this.advanced.sparseSteps,
						ss_rescale_t: this.advanced.sparseT,
						shape_slat_guidance_strength: this.advanced.shapeGuidance,
						shape_slat_guidance_rescale: this.advanced.shapeRescale,
						shape_slat_sampling_steps: this.advanced.shapeSteps,
						shape_slat_rescale_t: this.advanced.shapeT,
						tex_slat_guidance_strength: this.advanced.materialGuidance,
						tex_slat_guidance_rescale: this.advanced.materialRescale,
						tex_slat_sampling_steps: this.advanced.materialSteps,
						tex_slat_rescale_t: this.advanced.materialT
					})
				});
				const jobResult = await response.json();
				if (!response.ok) throw new Error(jobResult.detail || "Job creation failed");

				this.jobId = jobResult.job_id;
				this.jobMessage = "Job queued";

				// Poll job status
				await this.pollJobStatus(apiUrl);

			} catch (error) {
				this.showToast(error.message || this.$t("image3d.generationFailed"), "error");
				this.generating = false;
			}
		},
		async pollJobStatus(apiUrl) {
			const pollInterval = 2000; // 2 seconds
			const MAX_POLL_MS = 10 * 60 * 1000; // 10 minutes — guard against a job stuck in "processing"
			const deadline = Date.now() + MAX_POLL_MS;

			while (this.generating) {
				if (Date.now() > deadline) {
					this.showToast(this.$t("image3d.generationTimedOut"), "error");
					this.generating = false;
					return;
				}
				try {
					const response = await fetch(`${apiUrl}/jobs/${this.jobId}`);
					const status = await response.json();
					
					if (!response.ok) {
						throw new Error(status.detail || "Failed to get job status");
					}

					this.jobProgress = status.progress;
					this.jobMessage = status.message;

					if (status.status === "completed") {
						// GLB is now a public GCS URL — load directly into Three.js,
						// no base64 decode needed. revokeObjectURL only if it was a blob: URL.
						if (this.modelUrl && this.modelUrl.startsWith("blob:")) URL.revokeObjectURL(this.modelUrl);
						this.modelUrl = status.result.glb_url;
						this.generated = true;
						this.showToast(this.$t("image3d.generatedSuccess", { seconds: status.result.generation_time }));
						this.generating = false;
						return;
					} else if (status.status === "failed") {
						throw new Error(status.error || "Generation failed");
					}

					// Continue polling
					await new Promise(resolve => setTimeout(resolve, pollInterval));
				} catch (error) {
					this.showToast(error.message || this.$t("image3d.generationFailed"), "error");
					this.generating = false;
					return;
				}
			}
		},
		downloadGlb() {
			this.exportOpen = false;
			if (!this.modelUrl) {
				this.showToast(this.$t("image3d.generateBeforeExport"), "error");
				return;
			}
			const link = document.createElement("a");
			link.href = this.modelUrl;
			link.download = "trellis2-model.glb";
			link.style.display = "none";
			document.body.appendChild(link);
			link.click();
			link.remove();
		},
		fileToBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result.split(",")[1]);
				reader.onerror = () => reject(new Error(this.$t("image3d.imageReadFailed")));
				reader.readAsDataURL(file);
			});
		},
		publish() { this.publishOpen = false; },
		applySettings() {
			this.settingsApplied = true;
			this.advancedOpen = false;
			this.showToast(this.$t("image3d.settingsApplied"));
		},
		showToast(message, type = "success") {
			this.toastMessage = message;
			this.toastType = type;
			window.clearTimeout(this.toastTimer);
			this.toastTimer = window.setTimeout(() => { this.toastMessage = ""; }, 3200);
		}
	},
	beforeDestroy() {
		if (this.modelUrl && this.modelUrl.startsWith("blob:")) URL.revokeObjectURL(this.modelUrl);
	}
};
</script>
