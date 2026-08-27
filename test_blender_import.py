import bpy
import os

# Chạy script này trong Blender: Scripting tab → paste → Run Script
# Nó sẽ import FBX và báo cáo kết quả vào console

FBX_PATH = "/Users/plogg/Downloads/trellis2-model.fbx"  # <-- đổi đường dẫn nếu cần

if not os.path.exists(FBX_PATH):
    print(f"[TEST] File not found: {FBX_PATH}")
else:
    # Xóa scene cũ
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

    # Import FBX
    bpy.ops.import_scene.fbx(filepath=FBX_PATH)

    # Báo cáo
    meshes   = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    print(f"\n[TEST] Imported {len(meshes)} mesh(es)")

    for obj in meshes:
        mat_count = len(obj.data.materials)
        print(f"  mesh: {obj.name} — {len(obj.data.polygons)} polys — {mat_count} material(s)")
        for i, mat in enumerate(obj.data.materials):
            if mat is None:
                print(f"    mat[{i}]: None")
                continue
            node_tree = mat.node_tree
            tex_nodes = [n for n in node_tree.nodes if n.type == 'TEX_IMAGE'] if node_tree else []
            print(f"    mat[{i}]: {mat.name}")
            for tn in tex_nodes:
                img = tn.image
                if img:
                    packed = "PACKED" if img.packed_file else "external"
                    print(f"      texture: {img.name} ({img.size[0]}x{img.size[1]}) [{packed}]")
                else:
                    print(f"      texture node: no image")
