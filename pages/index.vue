<template>
	<main class="trellis-app">
		<app-header />
		<v-container fluid class="workspace pa-0">
			<v-row no-gutters class="workspace-row">
				<v-col cols="12" lg="3" xl="3" class="control-column">
					<aside class="control-panel pa-4 pa-md-6">
						<div class="eyebrow">
							{{ $t("image3d.eyebrow") }}
						</div>

						<h1 class="mt-1 mb-2">
							{{ $t("image3d.title") }}
						</h1>

						<p class="intro mb-5">
							{{ $t("image3d.description") }}
						</p>

						<image-upload @changed="hasImage = true" />

						<v-divider class="my-5" />

						<div class="generation-title d-flex align-center justify-space-between">
							<h2>{{ $t("image3d.generation") }}</h2>
							<span>TRELLIS.2 · 4B</span>
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
								<v-text-field
									outlined
									dense
									hide-details
									readonly
									:label="$t('image3d.glbTarget')"
									:value="$t('image3d.faces', { count: '500,000' })"
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
							:loading="generating"
							@click="generate"
						>
							{{
								generating
									? $t("image3d.generating")
									: $t("image3d.generate")
							}}
						</v-btn>
					</aside>
				</v-col>

				<v-col cols="12" lg="9" xl="9" class="preview-column">
					<section class="preview-panel">
						<v-row
							no-gutters
							class="preview-toolbar px-4 py-3 px-md-6 py-md-3"
						>
							<v-col
								cols="12"
								sm="auto"
								class="preview-tabs-column"
							>
								<div class="preview-tabs d-flex">
									<v-btn type="button" class="active">
										{{ $t("image3d.preview") }}
									</v-btn>

									<v-btn
										type="button"
										:class="{
											'is-inactive': !generated
										}"
										:aria-disabled="(!generated).toString()"
										@click="openExtract"
									>
										{{ $t("image3d.extract") }}
									</v-btn>
								</div>
							</v-col>

							<v-col
								cols="12"
								sm="auto"
								class="tool-actions-column"
							>
								<div class="tool-actions d-flex">
									<div class="menu-wrap">
										<v-btn
											type="button"
											class="export"
											:aria-expanded="exportOpen.toString()"
											aria-controls="export-menu"
											@click="toggleMenu('export')"
										>
											{{ $t("image3d.export") }}

											<svg
												class="menu-chevron"
												:class="{
													'is-open': exportOpen
												}"
												viewBox="0 0 24 24"
												aria-hidden="true"
											>
												<path d="m7 10 5 5 5-5" />
											</svg>
										</v-btn>

										<transition name="menu">
											<div
												v-if="exportOpen"
												id="export-menu"
												class="action-menu"
												role="menu"
											>
												<v-btn
													type="button"
													:disabled="!generated"
													role="menuitem"
													@click="downloadGlb"
												>
													{{ $t("image3d.exportGlb") }}

													<small>
														{{ $t("image3d.model") }}
													</small>
												</v-btn>
											</div>
										</transition>
									</div>

									<div class="menu-wrap">
										<v-btn
											type="button"
											class="publish"
											:aria-expanded="publishOpen.toString()"
											aria-controls="publish-menu"
											@click="toggleMenu('publish')"
										>
											{{ $t("image3d.publish") }}

											<svg
												class="menu-chevron"
												:class="{
													'is-open': publishOpen
												}"
												viewBox="0 0 24 24"
												aria-hidden="true"
											>
												<path d="m7 10 5 5 5-5" />
											</svg>
										</v-btn>

										<transition name="menu">
											<div
												v-if="publishOpen"
												id="publish-menu"
												class="action-menu publish-menu"
												role="menu"
											>
												<strong>
													{{ $t("image3d.publishAsset") }}
												</strong>

												<p>
													{{
														generated
															? $t(
																"image3d.readyToPublish"
															)
															: $t(
																"image3d.generateBeforePublish"
															)
													}}
												</p>

												<v-btn
													type="button"
													:disabled="!generated"
													role="menuitem"
													@click="publish"
												>
													{{ $t("image3d.publishNow") }}
												</v-btn>
											</div>
										</transition>
									</div>
								</div>
							</v-col>
						</v-row>

						<three-viewer :model-url="modelUrl" />
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
				class="advanced-modal"
				role="dialog"
				aria-modal="true"
				:aria-label="$t('image3d.advanced')"
			>
				<header>
					<div>
						<span class="eyebrow">TRELLIS.2 · 4B</span>

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

				<footer>
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
				class="app-toast"
				role="status"
			>
				<span>✓</span>
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
			hasImage: false, generating: false, generated: false, seed: "284739", texture: "2048 px", output: "PBR mesh · GLB", resolution: "1024", resolutions: ["512", "1024", "1536"], textureOptions: ["1024 px", "2048 px", "4096 px"], outputOptions: ["PBR mesh · GLB"], randomizeSeed: false,
			advancedOpen: false, exportOpen: false, publishOpen: false, modelUrl: "", settingsApplied: false, toastMessage: "", toastTimer: null,
			advanced: { sparseGuidance: 7.5, sparseRescale: .7, sparseSteps: 12, sparseT: 5, shapeGuidance: 7.5, shapeRescale: .5, shapeSteps: 12, shapeT: 3, materialGuidance: 1, materialRescale: 0, materialSteps: 12, materialT: 3 },
			advancedStages: [
				{ name: "image3d.stages.sparse", fields: [{ key: "sparseGuidance", label: "image3d.fields.guidance", min: 1, max: 10, step: .1 }, { key: "sparseRescale", label: "image3d.fields.guidanceRescale", min: 0, max: 1, step: .01 }, { key: "sparseSteps", label: "image3d.fields.samplingSteps", min: 1, max: 50, step: 1 }, { key: "sparseT", label: "image3d.fields.rescaleT", min: 1, max: 6, step: .1 }] },
				{ name: "image3d.stages.shape", fields: [{ key: "shapeGuidance", label: "image3d.fields.guidance", min: 1, max: 10, step: .1 }, { key: "shapeRescale", label: "image3d.fields.guidanceRescale", min: 0, max: 1, step: .01 }, { key: "shapeSteps", label: "image3d.fields.samplingSteps", min: 1, max: 50, step: 1 }, { key: "shapeT", label: "image3d.fields.rescaleT", min: 1, max: 6, step: .1 }] },
				{ name: "image3d.stages.material", fields: [{ key: "materialGuidance", label: "image3d.fields.guidance", min: 1, max: 10, step: .1 }, { key: "materialRescale", label: "image3d.fields.guidanceRescale", min: 0, max: 1, step: .01 }, { key: "materialSteps", label: "image3d.fields.samplingSteps", min: 1, max: 50, step: 1 }, { key: "materialT", label: "image3d.fields.rescaleT", min: 1, max: 6, step: .1 }] }
			]
		};
	},
	methods: {
		openExtract() {
			if (this.generated) this.exportOpen = true;
		},
		toggleMenu(menu) {
			const isOpen = menu === "export" ? this.exportOpen : this.publishOpen;
			this.exportOpen = menu === "export" && !isOpen;
			this.publishOpen = menu === "publish" && !isOpen;
		},
		generate() {
			this.generating = true;
			if (this.randomizeSeed) this.seed = Math.floor(Math.random() * 4294967295).toString();
			window.setTimeout(() => { this.generating = false; this.generated = true; }, 700);
		},
		downloadGlb() {
			this.exportOpen = false;
			if (this.modelUrl) window.open(this.modelUrl, "_blank");
		},
		publish() { this.publishOpen = false; },
		applySettings() {
			this.settingsApplied = true;
			this.advancedOpen = false;
			this.showToast(this.$t("image3d.settingsApplied"));
		},
		showToast(message) {
			this.toastMessage = message;
			window.clearTimeout(this.toastTimer);
			this.toastTimer = window.setTimeout(() => { this.toastMessage = ""; }, 3200);
		}
	}
};
</script>
