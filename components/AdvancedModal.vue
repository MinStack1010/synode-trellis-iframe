<template>
	<div
		v-if="open"
		class="modal-backdrop"
		@click.self="$emit('close')"
	>
		<section
			class="advanced-modal d-flex flex-column"
			role="dialog"
			aria-modal="true"
			:aria-label="$t('image3d.advanced')"
		>
			<header class="d-flex align-start justify-space-between">
				<h2>{{ $t("image3d.advanced") }}</h2>
				<v-btn
					icon
					type="button"
					:aria-label="$t('image3d.close')"
					@click="$emit('close')"
				>
					<v-icon size="20">mdi-close</v-icon>
				</v-btn>
			</header>

			<div class="advanced-content">
				<div
					v-for="stage in stages"
					:key="stage.name"
					class="advanced-stage"
				>
					<h3>{{ $t(stage.name) }}</h3>
					<div class="advanced-grid">
						<v-text-field
							v-for="field in stage.fields"
							:key="field.key"
							:value="values[field.key]"
							outlined
							dense
							hide-details
							type="number"
							:label="$t(field.label)"
							:min="field.min"
							:max="field.max"
							:step="field.step"
							@input="$emit('update', field.key, Number($event))"
						/>
					</div>
				</div>
			</div>

			<footer class="d-flex justify-end">
				<v-btn 
					type="button" 
					class="secondary" 
					@click="$emit('close')"
				>
					{{ $t("image3d.cancel") }}
				</v-btn>
				<v-btn 
					type="button" 
					class="generate" 
					@click="$emit('apply')"
				>
					{{ $t("image3d.applySettings") }}
				</v-btn>
			</footer>
		</section>
	</div>
</template>

<script>
export default {
	name: "AdvancedModal",
	props: {
		open:   { type: Boolean, default: false },
		values: { type: Object,  required: true },
		stages: { type: Array,   required: true },
	},
	emits: ["close", "apply", "update"],
};
</script>
