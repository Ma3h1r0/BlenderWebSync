const WebSocket = require('ws');
const net = require('net');
const zlib = require('zlib');

// 错误处理
function handleError(error, source) {
    console.error(`[${source}] 错误:`, error);
}

// WebSocket服务器
let wsServer;
try {
    wsServer = new WebSocket.Server({ port: 9767 });
    console.log('WebSocket服务器启动成功，监听端口 9767');
} catch (error) {
    handleError(error, 'WebSocket');
}

let wsClients = new Set();

// TCP服务器
const tcpServer = net.createServer();
let dataBuffer = Buffer.alloc(0);
let expectedDataSize = null;

// 处理TCP连接
tcpServer.on('connection', (socket) => {
    console.log('Blender已连接');
    
    socket.setKeepAlive(true, 1000);
    socket.setNoDelay(true);

    socket.on('data', (data) => {
        try {
            // 将新数据添加到缓冲区
            dataBuffer = Buffer.concat([dataBuffer, data]);

            // 如果还没有读取数据大小
            if (expectedDataSize === null && dataBuffer.length >= 4) {
                expectedDataSize = dataBuffer.readUInt32BE(0);
                dataBuffer = dataBuffer.slice(4);
                console.log(`接收到新数据包，大小: ${expectedDataSize} 字节`);
            }

            // 如果已经有了完整的数据
            if (expectedDataSize !== null && dataBuffer.length >= expectedDataSize) {
                const compressedData = dataBuffer.slice(0, expectedDataSize);
                console.log(`处理数据包，压缩大小: ${compressedData.length} 字节`);
                
                // 解压数据
                zlib.inflate(compressedData, (err, result) => {
                    if (err) {
                        handleError(err, '数据解压');
                        return;
                    }

                    console.log(`数据解压完成，原始大小: ${result.length} 字节`);

                    // 发送到所有WebSocket客户端
                    const data = result.toString();
                    let clientCount = 0;
                    wsClients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(data);
                            clientCount++;
                        }
                    });
                    console.log(`数据已发送给 ${clientCount} 个客户端`);
                });

                // 清理缓冲区
                dataBuffer = dataBuffer.slice(expectedDataSize);
                expectedDataSize = null;
            }
        } catch (error) {
            handleError(error, '数据处理');
            dataBuffer = Buffer.alloc(0);
            expectedDataSize = null;
        }
    });

    socket.on('error', (error) => {
        handleError(error, 'TCP Socket');
    });

    socket.on('close', () => {
        console.log('Blender已断开连接');
    });
});

tcpServer.on('error', (error) => {
    handleError(error, 'TCP Server');
});

// 处理WebSocket连接
wsServer.on('connection', (ws) => {
    console.log('WebSocket客户端已连接');
    wsClients.add(ws);
    console.log(`当前连接的客户端数量: ${wsClients.size}`);

    ws.on('close', () => {
        console.log('WebSocket客户端已断开连接');
        wsClients.delete(ws);
        console.log(`当前连接的客户端数量: ${wsClients.size}`);
    });

    ws.on('error', (error) => {
        handleError(error, 'WebSocket Client');
    });
});

// 启动TCP服务器
try {
    tcpServer.listen(9766, '0.0.0.0', () => {
        console.log('TCP服务器启动成功，监听端口 9766');
        console.log('服务器地址:', tcpServer.address());
    });
} catch (error) {
    handleError(error, 'TCP Server Start');
}

// 优雅关闭
process.on('SIGINT', () => {
    console.log('正在关闭服务器...');
    wsServer.close(() => {
        console.log('WebSocket服务器已关闭');
    });
    tcpServer.close(() => {
        console.log('TCP服务器已关闭');
        process.exit(0);
    });
}); 