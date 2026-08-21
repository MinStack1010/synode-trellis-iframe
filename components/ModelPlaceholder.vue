<template>
    <div class="model-stage">
        <div class="stage-horizon"></div>
        <div class="toy-car" :class="{ 'is-ready': generated }">
            <div class="car-roof">
                <div class="windshield"></div>
            </div>
            <div class="car-body">
                <div class="headlight left"></div>
                <div class="headlight right"></div>
            </div>
            <div class="bumper"></div>
            <div class="wheel wheel-left"><i></i></div>
            <div class="wheel wheel-right"><i></i></div>
        </div>
        <!-- <div class="stage-hint">{{ $t("image3d.hint") }}</div> -->
        <div class="asset-status">
            <div class="status-title">
                {{ generated ? $t("image3d.generatedAsset") : $t("image3d.preview") }} 
                <span :class="{ ready: generated }">
                    {{ generated ? $t("image3d.ready") : $t("image3d.waiting") }}
                </span>
            </div>
            <template v-if="generated">
                <p>{{ $t("image3d.pipeline") }} <b>1024 cascade</b></p>
                <p>{{ $t("image3d.texture") }} <b>2048 px PBR</b></p>
                <p>{{ $t("image3d.glbTarget") }} <b>500k faces</b></p>
            </template>
            <p v-else>{{ $t("image3d.uploadToGenerate") }}</p>
        </div>
    </div>
</template>

<script>
export default {
    name: "ModelPlaceholder",
    props: { generated: Boolean }
};
</script>
