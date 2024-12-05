let scene, camera, renderer, mesh;
let controls;
let socket;
let gridHelper, axesHelper;
let lastFrameTime = 0;
let isAutoRotating = false;

function init() {
    // 初始化Three.js场景
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x1e1e1e);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // 设置相机位置
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    // 添加轨道控制器
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;

    // 添加光源
    const light1 = new THREE.DirectionalLight(0xffffff, 0.8);
    light1.position.set(1, 1, 1);
    scene.add(light1);

    const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
    light2.position.set(-1, -1, -1);
    scene.add(light2);

    scene.add(new THREE.AmbientLight(0x404040));

    // 添加网格辅助线
    gridHelper = new THREE.GridHelper(10, 10);
    scene.add(gridHelper);

    // 添加坐标轴辅助线
    axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // 启动UDP连接
    initUDPConnection();

    // 初始化UI控件
    initializeUI();

    animate();

    // 隐藏加载动画
    document.querySelector('.loading-overlay').classList.add('hidden');
}

function initializeUI() {
    // 重置视图按钮
    document.getElementById('reset-view').addEventListener('click', () => {
        if (mesh) {
            const boundingSphere = mesh.geometry.boundingSphere;
            if (boundingSphere) {
                resetCamera(boundingSphere);
            }
        }
    });

    // 切换线框模式按钮
    document.getElementById('toggle-wireframe').addEventListener('click', (e) => {
        if (mesh) {
            mesh.material.wireframe = !mesh.material.wireframe;
            e.target.closest('.control-button').classList.toggle('active');
        }
    });

    // 切换自动旋转按钮
    document.getElementById('toggle-autorotate').addEventListener('click', (e) => {
        isAutoRotating = !isAutoRotating;
        e.target.closest('.control-button').classList.toggle('active');
    });

    // 切换网格按钮
    document.getElementById('toggle-grid').addEventListener('click', (e) => {
        gridHelper.visible = !gridHelper.visible;
        axesHelper.visible = !axesHelper.visible;
        e.target.closest('.control-button').classList.toggle('active');
    });
}

function resetCamera(boundingSphere) {
    const radius = boundingSphere.radius;
    const center = boundingSphere.center;
    
    const distance = radius * 3;
    camera.position.set(distance, distance, distance);
    controls.target.copy(center);
    
    camera.near = radius * 0.1;
    camera.far = radius * 20;
    camera.updateProjectionMatrix();
    
    controls.update();
}

function initUDPConnection() {
    // 使用WebSocket作为TCP代理
    socket = new WebSocket('ws://192.168.2.3:9767');
    const statusElement = document.getElementById('status');

    socket.onopen = () => {
        statusElement.innerHTML = '<span class="material-icons">wifi</span><span>已连接</span>';
        statusElement.className = 'connected';
    };

    socket.onclose = () => {
        statusElement.innerHTML = '<span class="material-icons">wifi_off</span><span>断开连接</span>';
        statusElement.className = 'disconnected';
        // 尝试重新连接
        setTimeout(initUDPConnection, 1000);
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            updateMesh(data);
        } catch (error) {
            console.error('解析消息时出错:', error);
        }
    };
}

function updateMesh(data) {
    if (!mesh) {
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.MeshStandardMaterial({
            color: 0x808080,
            wireframe: false,
            side: THREE.FrontSide,
            flatShading: true,
            roughness: 0.7,
            metalness: 0.3
        });
        mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
    }

    // 更新顶点和面
    const vertices = new Float32Array(data.vertices.flat());
    const indices = new Uint32Array(data.faces.flat());

    // 清除旧的几何数据
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    
    // 设置新的几何数据
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    mesh.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    
    // 重新计算法线和边界
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();

    // 更新变换矩阵
    if (data.transform) {
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.set(1, 1, 1);
        
        const matrix = new THREE.Matrix4();
        matrix.fromArray(data.transform.flat());
        mesh.applyMatrix4(matrix);
    }

    // 更新调试信息
    updateDebugInfo();
}

function updateDebugInfo() {
    if (mesh) {
        const vertexCount = mesh.geometry.attributes.position.count;
        const faceCount = mesh.geometry.index ? mesh.geometry.index.count / 3 : 0;
        document.querySelector('.mesh-info').textContent = `顶点: ${vertexCount} | 面: ${faceCount}`;
    }
}

function updateFPS() {
    const now = performance.now();
    const delta = now - lastFrameTime;
    lastFrameTime = now;
    const fps = Math.round(1000 / delta);
    document.querySelector('.fps-info').textContent = `FPS: ${fps}`;
}

function animate() {
    requestAnimationFrame(animate);
    
    if (isAutoRotating && mesh) {
        mesh.rotation.y += 0.01;
    }
    
    controls.update();
    renderer.render(scene, camera);
    updateFPS();
}

// 添加窗口大小调整处理
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// 初始化场景
init();