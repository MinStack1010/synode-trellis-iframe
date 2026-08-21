<template>
    <section>
        <div 
            class="upload-box" 
            :class="{ 'has-image': preview, 'dragging': dragging }" 
            role="button" 
            tabindex="0"
            @click="openPicker" 
            @keydown.enter.prevent="openPicker" 
            @dragenter.prevent="dragging = true"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false" 
            @drop.prevent="onDrop"    
        >
            <img 
                v-if="preview" 
                :src="preview" 
                :alt="$t('image3d.selectedSource')" 
                class="upload-preview" 
            />
            <div v-else class="upload-empty d-flex flex-column align-center">
                <span class="upload-icon d-flex align-center justify-center">
                    <v-icon color="grey" size="22">
                        mdi-upload
                    </v-icon>
                </span>
                <strong>{{ $t("image3d.drop") }}</strong>
                <div class="text-subtitle-2">
                    {{ $t("image3d.formats") }}
                </div>
            </div>
            <label class="replace-image" @click.stop>
                {{ preview ? $t("image3d.replace") : $t("image3d.choose") }}
                <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" @change="onFileChanged" />
            </label>
        </div>
    </section>
</template>

<script>
export default {
    name: "ImageUpload",
    data() { return { preview: null, dragging: false }; },
    methods: {
        setFile(file)
        {
            if (!file || !file.type.startsWith("image/")) return;
            if (this.preview) URL.revokeObjectURL(this.preview);
            this.preview = URL.createObjectURL(file);
            this.$emit("changed", file);
        },
        openPicker() { this.$refs.fileInput.click(); },
        onFileChanged(event) { this.setFile(event.target.files[0]); },
        onDrop(event) { this.dragging = false; this.setFile(event.dataTransfer.files[0]); }
    },
    beforeDestroy()
    {
        if (this.preview) URL.revokeObjectURL(this.preview);
    }
};
</script>
