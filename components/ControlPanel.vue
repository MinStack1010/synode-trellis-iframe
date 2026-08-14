<template>
	<aside class="control-panel w-100 pa-4 pa-md-6">
		<div class="eyebrow">
			{{ $t("image3d.eyebrow") }}
		</div>

		<h1 class="mt-1 mb-2">
			{{ $t("image3d.title") }}
		</h1>

		<image-upload ref="imageUpload" @changed="$emit('image-changed', $event)" />

		<v-divider class="my-5" />

		<div class="generation-title d-flex align-center justify-space-between">
			<h2>{{ $t("image3d.generation") }}</h2>
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
				:class="{ 'resolution-selected': resolution === item }"
				@click="$emit('update:resolution', item)"
			>
				{{ item }}²
			</v-btn>
		</div>

		<v-row dense class="form-grid ma-0">
			<v-col cols="12" sm="6" class="pa-1">
				<v-text-field
					:value="seed"
					outlined
					dense
					hide-details
					:label="$t('image3d.seed')"
					inputmode="numeric"
					@input="$emit('update:seed', $event)"
				/>
			</v-col>

			<v-col cols="12" sm="6" class="pa-1">
				<v-select
					:value="texture"
					outlined
					dense
					hide-details
					:label="$t('image3d.textureSize')"
					:items="textureOptions"
					@input="$emit('update:texture', $event)"
				/>
			</v-col>

			<v-col cols="12" sm="6" class="pa-1">
				<v-select
					:value="decimationTarget"
					outlined
					dense
					hide-details
					:label="$t('image3d.glbTarget')"
					:items="decimationOptions"
					@input="$emit('update:decimation-target', $event)"
				/>
			</v-col>

			<v-col cols="12" sm="6" class="pa-1">
				<v-select
					:value="output"
					outlined
					dense
					hide-details
					:label="$t('image3d.output')"
					:items="outputOptions"
					@input="$emit('update:output', $event)"
				/>
			</v-col>
		</v-row>

		<v-checkbox
			:input-value="randomizeSeed"
			class="check mt-2 mb-3"
			dense
			hide-details
			:label="$t('image3d.randomize')"
			@change="$emit('update:randomize-seed', $event)"
		/>

		<v-btn
			type="button"
			outlined
			block
			height="48"
			class="advanced"
			:class="{ configured: settingsApplied }"
			@click="$emit('open-advanced')"
		>
			<span>
				{{ $t("image3d.advanced") }}
				<small v-if="settingsApplied">{{ $t("image3d.applied") }}</small>
			</span>
			<v-spacer />
			<b>+</b>
		</v-btn>

		<transition name="banner-slide">
			<div
				v-if="resumedFromStorage"
				class="resume-banner d-flex align-center mt-3"
				role="status"
			>
				<span class="resume-banner__dot" aria-hidden="true" />
				<span>{{ $t("image3d.resumeBanner") }}</span>
			</div>
		</transition>

		<v-tooltip
			:disabled="!generating && !serverBusy"
			top
			max-width="260"
			content-class="generate-tooltip"
		>
			<template #activator="{ on, attrs }">
				<span v-bind="attrs" v-on="on" class="generate-btn-wrap mt-3 d-block">
					<v-btn
						type="button"
						block
						height="52"
						class="generate"
						:disabled="!hasImage || generating || (serverBusy && !generating)"
						@click="$emit('generate')"
					>
						<span v-if="generating" class="btn-spinner" aria-hidden="true" />
						<span v-if="generating">
							<template v-if="jobQueuePosition !== null">
								{{
									jobQueuePosition === 1
										? $t("image3d.queuePositionNext")
										: $t("image3d.queuePosition", { position: jobQueuePosition })
								}}
							</template>
							<template v-else>
								{{ $t("image3d.generating") }}<template v-if="jobProgress > 0"> ({{ Math.round(jobProgress) }}%)</template>
							</template>
						</span>
						<span v-else>
							{{ $t("image3d.generate") }}
						</span>
					</v-btn>
				</span>
			</template>
			<span>{{ serverBusy && !generating ? $t("image3d.serverBusyShort") : $t("image3d.generateBusy") }}</span>
		</v-tooltip>

		<transition name="banner-slide">
			<div
				v-if="serverBusy && !generating"
				class="server-busy-hint mt-2 mb-0"
				role="status"
			>
				<span class="server-busy-hint__dot" aria-hidden="true" />
				<span>
					{{ $t("image3d.serverBusyShort") }}
					<template v-if="serverEstimatedWait !== null">
						—
						{{
							serverEstimatedWait < 60
								? $t("image3d.lessThanMinute")
								: "~" + Math.ceil(serverEstimatedWait / 60) + " " + $t("image3d.minutesLeft")
						}}
					</template>
				</span>
			</div>
		</transition>
	</aside>
</template>

<script>
import ImageUpload from "~/components/ImageUpload.vue";

export default {
	name: "ControlPanel",
	components: { ImageUpload },

	props: {
		hasImage: { type: Boolean, required: true },
		generating: { type: Boolean, required: true },
		jobProgress: { type: Number, default: 0 },
		jobQueuePosition: { type: Number, default: null },
		resumedFromStorage: { type: Boolean, default: false },
		settingsApplied: { type: Boolean, default: false },

		serverBusy: { type: Boolean, default: false },
		serverEstimatedWait: { type: Number, default: null },

		resolution: { type: String, required: true },
		seed: { type: String, required: true },
		texture: { type: Number, required: true },
		decimationTarget: { type: Number, required: true },
		output: { type: String, required: true },
		randomizeSeed: { type: Boolean, required: true },

		resolutions: { type: Array, required: true },
		textureOptions: { type: Array, required: true },
		decimationOptions: { type: Array, required: true },
		outputOptions: { type: Array, required: true },
	},

	emits: [
		"image-changed",
		"generate",
		"open-advanced",
		"update:resolution",
		"update:seed",
		"update:texture",
		"update:decimation-target",
		"update:output",
		"update:randomize-seed",
	],

	methods: {
		setFile(file) {
			if (this.$refs.imageUpload?.setFile) {
				this.$refs.imageUpload.setFile(file);
			}
		},
	},
};
</script>
