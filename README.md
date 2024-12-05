# BlenderWebSync
实时同步Blender 3D模型到Web浏览器的工具（在Blender中编辑模型时，在网页中实时预览效果。）


## 安装步骤

### 1. Web服务器设置

1. 进入web目录：
   ```bash
   cd web
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 启动服务器：
   ```bash
   node server.js
   ```

### 2. Blender插件安装

1. 在Blender中，转到 Edit > Preferences > Add-ons
2. 点击 "Install..."
3. 选择 `blender_addon/web_sync.py` 文件
4. 启用插件（勾选复选框）
