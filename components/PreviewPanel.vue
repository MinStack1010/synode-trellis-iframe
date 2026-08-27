<template>
	<section class="preview-panel w-100">
		<v-row
			no-gutters
			class="preview-toolbar align-center justify-end px-4 py-3 px-md-6 py-md-3"
		>
			<v-col cols="auto" class="tool-actions-column">
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
								:class="{ 'is-open': exportOpen }"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path d="m7 10 5 5 5-5" />
							</svg>
						</v-btn>

						<transition name="menu">
							<div v-if="exportOpen" id="export-menu" class="action-menu" role="menu">
								<v-btn
									type="button"
									:disabled="!generated"
									role="menuitem"
									@click="$emit('download-glb')"
								>
									{{ $t("image3d.exportGlb") }}
								</v-btn>

								<v-btn
									type="button"
									:disabled="!generated"
									role="menuitem"
									@click="$emit('download-fbx')"
								>
									{{ $t("image3d.exportFbx") }}
								</v-btn>

								<v-btn
									type="button"
									:disabled="!generated"
									role="menuitem"
									@click="$emit('download-usdz')"
								>
									{{ $t("image3d.exportUsdz") }}
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
								:class="{ 'is-open': publishOpen }"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
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
			ref="viewer"
			:model-url="modelUrl"
			:generating="generating"
			:progress="jobProgress"
			:queue-position="jobQueuePosition"
		/>
	</section>
</template>

<script>
import ThreeViewer from "~/components/ThreeViewer.vue";

export default {
	name: "PreviewPanel",
	components: { ThreeViewer },

	props: {
		modelUrl: { type: String, default: "" },
		generated: { type: Boolean, default: false },
		generating: { type: Boolean, default: false },
		jobProgress: { type: Number, default: 0 },
		jobQueuePosition: { type: Number, default: null },
	},

	emits: ["download-glb", "download-fbx", "download-usdz"],

	data() {
		return {
			exportOpen:  false,
			publishOpen: false,
		};
	},

	methods: {
		toggleMenu(menu) {
			const isOpen = menu === "export" ? this.exportOpen : this.publishOpen;
			this.exportOpen  = menu === "export"   && !isOpen;
			this.publishOpen = menu === "publish"  && !isOpen;
		},

		/** Expose the inner ThreeViewer ref to parent components */
		getViewer() {
			return this.$refs.viewer || null;
		},
		
		/** Expose model from ThreeViewer for export */
		getModel() {
			return this.$refs.viewer?.getModel?.() || null;
		},
		
		/** Expose THREE library from ThreeViewer for export */
		getThree() {
			return this.$refs.viewer?.getThree?.() || null;
		},

		_onDocClick(e) {
			if (!this.$el.contains(e.target)) {
				this.exportOpen  = false;
				this.publishOpen = false;
			}
		},
	},

	mounted() {
		document.addEventListener("click", this._onDocClick, true);
	},

	beforeDestroy() {
		document.removeEventListener("click", this._onDocClick, true);
	},
};
</script>
