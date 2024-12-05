import bpy
import json
import socket
import threading
import time
import zlib
from datetime import datetime
from bpy.app.handlers import persistent

bl_info = {
    "name": "Web Sync",
    "author": "Ma3h1r0",
    "version": (1, 0),
    "blender": (2, 80, 0),
    "location": "View3D > Sidebar > Web Sync",
    "description": "将3D模型与浏览器实时同步 Sync 3D models with web browser in real-time",
    "category": "3D View",
}

# 全局变量
tcp_socket = None
is_server_running = False
last_data = None
sync_stats = {
    'start_time': None,
    'packets_sent': 0,
    'bytes_sent': 0,
    'last_sync_time': None,
    'sync_rate': 0,
    'errors': 0
}

def log_message(message, level='INFO'):
    """记录日志消息"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
    print(f"[{timestamp}] [{level}] WebSync: {message}")

def format_bytes(size):
    """格式化字节大小"""
    for unit in ['B', 'KB', 'MB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} GB"

def update_sync_stats(data_size=0, is_error=False):
    """更新同步统计信息"""
    global sync_stats
    current_time = time.time()
    
    if sync_stats['start_time'] is None:
        sync_stats['start_time'] = current_time
    
    if not is_error:
        sync_stats['packets_sent'] += 1
        sync_stats['bytes_sent'] += data_size
        
        if sync_stats['last_sync_time']:
            delta = current_time - sync_stats['last_sync_time']
            sync_stats['sync_rate'] = 1.0 / delta if delta > 0 else 0
        
        sync_stats['last_sync_time'] = current_time
    else:
        sync_stats['errors'] += 1

def get_sync_stats():
    """获取同步统计信息的格式化字符串"""
    if not sync_stats['start_time']:
        return "未开始同步"
    
    runtime = time.time() - sync_stats['start_time']
    hours = int(runtime // 3600)
    minutes = int((runtime % 3600) // 60)
    seconds = int(runtime % 60)
    
    return (
        f"运行时间: {hours:02d}:{minutes:02d}:{seconds:02d}\n"
        f"已发送数据包: {sync_stats['packets_sent']}\n"
        f"已发送数据: {format_bytes(sync_stats['bytes_sent'])}\n"
        f"同步频率: {sync_stats['sync_rate']:.2f} Hz\n"
        f"错误次数: {sync_stats['errors']}"
    )

def send_data(data_str):
    """发送数据到TCP服务器"""
    try:
        global tcp_socket
        if not tcp_socket:
            return False
            
        # 压缩数据
        compressed_data = zlib.compress(data_str.encode())
        
        # 发送数据大小
        size = len(compressed_data)
        tcp_socket.send(size.to_bytes(4, byteorder='big'))
        
        # 发送压缩数据
        tcp_socket.send(compressed_data)
        
        return True
    except Exception as e:
        log_message(f"发送数据失败: {str(e)}", "ERROR")
        return False

def send_mesh_data():
    """发送网格数据的函数"""
    global is_server_running, last_data
    
    if not is_server_running:
        return
    
    try:
        for window in bpy.context.window_manager.windows:
            screen = window.screen
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    obj = window.view_layer.objects.active
                    if obj and obj.type == 'MESH':
                        log_message(f"正在处理模型: {obj.name}")
                        
                        # 确保网格数据是最新的
                        depsgraph = window.view_layer.depsgraph
                        obj_eval = obj.evaluated_get(depsgraph)
                        mesh = obj_eval.to_mesh()
                        
                        # 三角化网格
                        import bmesh
                        bm = bmesh.new()
                        bm.from_mesh(mesh)
                        bmesh.ops.triangulate(bm, faces=bm.faces)
                        bm.to_mesh(mesh)
                        bm.free()
                        
                        log_message(f"顶点数: {len(mesh.vertices)}, 面数: {len(mesh.polygons)}")
                        
                        # 收集顶点数据
                        vertices = []
                        for v in mesh.vertices:
                            co = obj.matrix_world @ v.co
                            vertices.append([co.x, co.y, co.z])
                        
                        # 收集面数据（确保正确的顶点顺序）
                        faces = []
                        for p in mesh.polygons:
                            if len(p.vertices) == 3:  # 只处理三角形
                                faces.append([p.vertices[0], p.vertices[1], p.vertices[2]])
                        
                        mesh_data = {
                            'vertices': vertices,
                            'faces': faces,
                            'name': obj.name,
                            'transform': [[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,1]]
                        }
                        
                        # 将数据转换为JSON字符串
                        data_str = json.dumps(mesh_data)
                        data_size = len(data_str.encode())
                        
                        # 如果数据与上次发送的不同，发送
                        if data_str != last_data:
                            log_message(f"准备发送数据，大小: {format_bytes(data_size)}")
                            if send_data(data_str):
                                last_data = data_str
                                update_sync_stats(data_size)
                                log_message("数据发送完成")
                        else:
                            log_message("数据未变化，跳过发送")
                        
                        # 清理临时网格
                        obj_eval.to_mesh_clear()
                    else:
                        log_message("没有活动的网格对象", "WARNING")
                    break
            break
    except Exception as e:
        error_msg = f"发送数据时出错: {str(e)}"
        log_message(error_msg, "ERROR")
        update_sync_stats(is_error=True)
        import traceback
        log_message(traceback.format_exc(), "ERROR")

class WebSyncSettings(bpy.types.PropertyGroup):
    is_running: bpy.props.BoolProperty(
        name="Sync Active",
        default=False
    )
    port: bpy.props.IntProperty(
        name="Port",
        default=9766
    )
    show_stats: bpy.props.BoolProperty(
        name="Show Statistics",
        default=True
    )

class StartWebSyncServer(bpy.types.Operator):
    bl_idname = "web_sync.start_server"
    bl_label = "Start Sync"
    
    def execute(self, context):
        global tcp_socket, is_server_running
        
        if not is_server_running:
            try:
                log_message("正在连接到服务器...")
                tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                tcp_socket.connect(('localhost', context.scene.web_sync_settings.port))
                is_server_running = True
                context.scene.web_sync_settings.is_running = True
                
                # 重置统计信息
                global sync_stats
                sync_stats = {
                    'start_time': time.time(),
                    'packets_sent': 0,
                    'bytes_sent': 0,
                    'last_sync_time': None,
                    'sync_rate': 0,
                    'errors': 0
                }
                
                log_message("已连接到服务器")
                
            except Exception as e:
                error_msg = f"连接服务器失败: {str(e)}"
                log_message(error_msg, "ERROR")
                self.report({'ERROR'}, error_msg)
                return {'CANCELLED'}
            
        return {'FINISHED'}

class StopWebSyncServer(bpy.types.Operator):
    bl_idname = "web_sync.stop_server"
    bl_label = "Stop Sync"
    
    def execute(self, context):
        global tcp_socket, is_server_running
        
        log_message("正在断开连接...")
        is_server_running = False
        context.scene.web_sync_settings.is_running = False
        
        if tcp_socket:
            tcp_socket.close()
            tcp_socket = None
        
        log_message("已断开连接")
        log_message("\n=== 同步统计信息 ===\n" + get_sync_stats())
        return {'FINISHED'}

class WebSyncPanel(bpy.types.Panel):
    bl_label = "Web Sync"
    bl_idname = "VIEW3D_PT_web_sync"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Web Sync'

    def draw(self, context):
        layout = self.layout
        settings = context.scene.web_sync_settings

        layout.prop(settings, "port")
        layout.prop(settings, "show_stats")
        
        if not settings.is_running:
            layout.operator("web_sync.start_server")
        else:
            layout.operator("web_sync.stop_server")
            
            if settings.show_stats:
                box = layout.box()
                for line in get_sync_stats().split('\n'):
                    box.label(text=line)

@persistent
def load_handler(dummy):
    global tcp_socket, is_server_running
    is_server_running = False
    if tcp_socket:
        tcp_socket.close()
        tcp_socket = None
    if hasattr(bpy.context.scene, 'web_sync_settings'):
        bpy.context.scene.web_sync_settings.is_running = False
    log_message("场景已加载，同步服务器已重置")

@persistent
def depsgraph_update_handler(scene, depsgraph):
    """场景更新时的处理函数"""
    if is_server_running:
        send_mesh_data()

classes = (
    WebSyncSettings,
    WebSyncPanel,
    StartWebSyncServer,
    StopWebSyncServer,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.web_sync_settings = bpy.props.PointerProperty(type=WebSyncSettings)
    bpy.app.handlers.load_post.append(load_handler)
    if depsgraph_update_handler not in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.append(depsgraph_update_handler)
    log_message("插件已注册")

def unregister():
    global is_server_running, tcp_socket
    is_server_running = False
    if tcp_socket:
        tcp_socket.close()
        tcp_socket = None
    
    if depsgraph_update_handler in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.remove(depsgraph_update_handler)
    
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.web_sync_settings
    bpy.app.handlers.load_post.remove(load_handler)
    log_message("插件已注销")

if __name__ == "__main__":
    register()
