// Cloudflare Worker - 简化版优选工具
// 仅保留优选域名、优选IP、GitHub、上报和节点生成功能

// 默认配置
let customPreferredIPs = [];
let customPreferredDomains = [];
let epd = true;  // 启用优选域名
let epi = true;  // 启用优选IP
let egi = true;  // 启用GitHub优选
let ev = true;   // 启用VLESS协议
let et = false;  // 启用Trojan协议
let vm = false;  // 启用VMess协议
let scu = 'https://url.v1.mk/sub';  // 订阅转换地址

// 默认优选域名列表
const directDomains = [
    { name: "cloudflare.182682.xyz", domain: "cloudflare.182682.xyz" },
    { domain: "freeyx.cloudflare88.eu.org" },
    { domain: "bestcf.top" },
    { domain: "cdn.2020111.xyz" },
    { domain: "cf.0sm.com" },
    { domain: "cf.090227.xyz" },
    { domain: "cf.zhetengsha.eu.org" },
    { domain: "cfip.1323123.xyz" },
    { domain: "cloudflare-ip.mofashi.ltd" },
    { domain: "cf.877771.xyz" },
    { domain: "xn--b6gac.eu.org" }
];

// 默认优选IP来源URL
const defaultIPURL = 'https://raw.githubusercontent.com/qwer-search/bestip/refs/heads/main/kejilandbestip.txt';

// UUID验证
function isValidUUID(str) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
}

// 从环境变量获取配置
function getConfigValue(key, defaultValue) {
    return defaultValue || '';
}

// 获取动态IP列表（支持IPv4/IPv6和运营商筛选）
async function fetchDynamicIPs(ipv4Enabled = true, ipv6Enabled = true, ispMobile = true, ispUnicom = true, ispTelecom = true) {
    const v4Url = "https://www.wetest.vip/page/cloudflare/address_v4.html";
    const v6Url = "https://www.wetest.vip/page/cloudflare/address_v6.html";
    let results = [];

    try {
        const fetchPromises = [];
        if (ipv4Enabled) {
            fetchPromises.push(fetchAndParseWetest(v4Url));
        } else {
            fetchPromises.push(Promise.resolve([]));
        }
        if (ipv6Enabled) {
            fetchPromises.push(fetchAndParseWetest(v6Url));
        } else {
            fetchPromises.push(Promise.resolve([]));
        }

        const [ipv4List, ipv6List] = await Promise.all(fetchPromises);
        results = [...ipv4List, ...ipv6List];
        
        // 按运营商筛选
        if (results.length > 0) {
            results = results.filter(item => {
                const isp = item.isp || '';
                if (isp.includes('移动') && !ispMobile) return false;
                if (isp.includes('联通') && !ispUnicom) return false;
                if (isp.includes('电信') && !ispTelecom) return false;
                return true;
            });
        }
        
        return results.length > 0 ? results : [];
    } catch (e) {
        return [];
    }
}

// 解析wetest页面
async function fetchAndParseWetest(url) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) return [];
        const html = await response.text();
        const results = [];
        const rowRegex = /<tr[\s\S]*?<\/tr>/g;
        const cellRegex = /<td data-label="线路名称">(.+?)<\/td>[\s\S]*?<td data-label="优选地址">([\d.:a-fA-F]+)<\/td>[\s\S]*?<td data-label="数据中心">(.+?)<\/td>/;

        let match;
        while ((match = rowRegex.exec(html)) !== null) {
            const rowHtml = match[0];
            const cellMatch = rowHtml.match(cellRegex);
            if (cellMatch && cellMatch[1] && cellMatch[2]) {
                const colo = cellMatch[3] ? cellMatch[3].trim().replace(/<.*?>/g, '') : '';
                results.push({
                    isp: cellMatch[1].trim().replace(/<.*?>/g, ''),
                    ip: cellMatch[2].trim(),
                    colo: colo
                });
            }
        }
        return results;
    } catch (error) {
        return [];
    }
}

// 从GitHub获取优选IP
async function fetchAndParseNewIPs(piu) {
    const url = piu || defaultIPURL;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const text = await response.text();
        const results = [];
        const lines = text.trim().replace(/\r/g, "").split('\n');
        const regex = /^([^:]+):(\d+)#(.*)$/;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            const match = trimmedLine.match(regex);
            if (match) {
                results.push({
                    ip: match[1],
                    port: parseInt(match[2], 10),
                    name: match[3].trim() || match[1]
                });
            }
        }
        return results;
    } catch (error) {
        return [];
    }
}

// 生成VLESS链接
function generateLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/') {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';
    const proto = 'vless';

    list.forEach(item => {
        let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
        if (item.colo && item.colo.trim()) {
            nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
        }
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: false });
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            if (tls) {
                const wsNodeName = `${nodeNameBase}-${port}-WS-TLS`;
                const wsParams = new URLSearchParams({ 
                    encryption: 'none', 
                    security: 'tls', 
                    sni: workerDomain, 
                    fp: 'chrome', 
                    type: 'ws', 
                    host: workerDomain, 
                    path: wsPath
                });
                links.push(`${proto}://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            } else {
                const wsNodeName = `${nodeNameBase}-${port}-WS`;
                const wsParams = new URLSearchParams({
                    encryption: 'none',
                    security: 'none',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`${proto}://${user}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            }
        });
    });
    return links;
}

// 生成Trojan链接
async function generateTrojanLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/') {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';
    const password = user;  // Trojan使用UUID作为密码

    list.forEach(item => {
        let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
        if (item.colo && item.colo.trim()) {
            nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
        }
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                if (!disableNonTLS) {
                    portsToGenerate.push({ port: port, tls: false });
                }
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            if (tls) {
                const wsNodeName = `${nodeNameBase}-${port}-Trojan-WS-TLS`;
                const wsParams = new URLSearchParams({ 
                    security: 'tls', 
                    sni: workerDomain, 
                    fp: 'chrome', 
                    type: 'ws', 
                    host: workerDomain, 
                    path: wsPath
                });
                links.push(`trojan://${password}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            } else {
                const wsNodeName = `${nodeNameBase}-${port}-Trojan-WS`;
                const wsParams = new URLSearchParams({
                    security: 'none',
                    type: 'ws',
                    host: workerDomain,
                    path: wsPath
                });
                links.push(`trojan://${password}@${safeIP}:${port}?${wsParams.toString()}#${encodeURIComponent(wsNodeName)}`);
            }
        });
    });
    return links;
}

// 生成VMess链接
function generateVMessLinksFromSource(list, user, workerDomain, disableNonTLS = false, customPath = '/') {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const defaultHttpsPorts = [443];
    const defaultHttpPorts = disableNonTLS ? [] : [80];
    const links = [];
    const wsPath = customPath || '/';

    list.forEach(item => {
        let nodeNameBase = item.isp ? item.isp.replace(/\s/g, '_') : (item.name || item.domain || item.ip);
        if (item.colo && item.colo.trim()) {
            nodeNameBase = `${nodeNameBase}-${item.colo.trim()}`;
        }
        const safeIP = item.ip.includes(':') ? `[${item.ip}]` : item.ip;
        
        let portsToGenerate = [];
        
        if (item.port) {
            const port = item.port;
            if (CF_HTTPS_PORTS.includes(port)) {
                portsToGenerate.push({ port: port, tls: true });
            } else if (CF_HTTP_PORTS.includes(port)) {
                if (!disableNonTLS) {
                    portsToGenerate.push({ port: port, tls: false });
                }
            } else {
                portsToGenerate.push({ port: port, tls: true });
            }
        } else {
            defaultHttpsPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: true });
            });
            defaultHttpPorts.forEach(port => {
                portsToGenerate.push({ port: port, tls: false });
            });
        }

        portsToGenerate.forEach(({ port, tls }) => {
            const vmessConfig = {
                v: "2",
                ps: tls ? `${nodeNameBase}-${port}-VMess-WS-TLS` : `${nodeNameBase}-${port}-VMess-WS`,
                add: safeIP,
                port: port.toString(),
                id: user,
                aid: "0",
                scy: "auto",
                net: "ws",
                type: "none",
                host: workerDomain,
                path: wsPath,
                tls: tls ? "tls" : "none"
            };
            if (tls) {
                vmessConfig.sni = workerDomain;
                vmessConfig.fp = "chrome";
            }
            const vmessBase64 = btoa(JSON.stringify(vmessConfig));
            links.push(`vmess://${vmessBase64}`);
        });
    });
    return links;
}

// 从GitHub IP生成链接（VLESS）
function generateLinksFromNewIPs(list, user, workerDomain, customPath = '/') {
    const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
    const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
    const links = [];
    const wsPath = customPath || '/';
    const proto = 'vless';
    
    list.forEach(item => {
        const nodeName = item.name.replace(/\s/g, '_');
        const port = item.port;
        
        if (CF_HTTPS_PORTS.includes(port)) {
            const wsNodeName = `${nodeName}-${port}-WS-TLS`;
            const link = `${proto}://${user}@${item.ip}:${port}?encryption=none&security=tls&sni=${workerDomain}&fp=chrome&type=ws&host=${workerDomain}&path=${wsPath}#${encodeURIComponent(wsNodeName)}`;
            links.push(link);
        } else if (CF_HTTP_PORTS.includes(port)) {
            const wsNodeName = `${nodeName}-${port}-WS`;
            const link = `${proto}://${user}@${item.ip}:${port}?encryption=none&security=none&type=ws&host=${workerDomain}&path=${wsPath}#${encodeURIComponent(wsNodeName)}`;
            links.push(link);
        } else {
            const wsNodeName = `${nodeName}-${port}-WS-TLS`;
            const link = `${proto}://${user}@${item.ip}:${port}?encryption=none&security=tls&sni=${workerDomain}&fp=chrome&type=ws&host=${workerDomain}&path=${wsPath}#${encodeURIComponent(wsNodeName)}`;
            links.push(link);
        }
    });
    return links;
}

// 根据User-Agent自动识别客户端类型
function detectClientFromUA(userAgent) {
    if (!userAgent) return null;
    const ua = userAgent.toLowerCase();
    if (ua.includes('clash')) return 'clash';
    if (ua.includes('stash')) return 'stash';
    if (ua.includes('surge')) return 'surge';
    if (ua.includes('shadowrocket')) return 'base64';
    if (ua.includes('quantumult')) return 'base64';
    if (ua.includes('loon')) return 'loon';
    if (ua.includes('sing-box') || ua.includes('singbox')) return 'singbox';
    if (ua.includes('v2ray') || ua.includes('v2rayn') || ua.includes('v2rayng')) return 'base64';
    return null;
}

// 生成订阅内容
async function handleSubscriptionRequest(request, user, customDomain, piu, ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath) {
    const url = new URL(request.url);
    const finalLinks = [];
    const workerDomain = url.hostname;
    const nodeDomain = customDomain || url.hostname;
    
    // 自动识别客户端（优先使用URL参数，其次User-Agent）
    const userAgent = request.headers.get('User-Agent') || '';
    const autoTarget = detectClientFromUA(userAgent);
    const target = url.searchParams.get('target') || autoTarget || 'base64';
    const wsPath = customPath || '/';

    async function addNodesFromList(list) {
        // 确保至少有一个协议被启用
        const hasProtocol = evEnabled || etEnabled || vmEnabled;
        const useVL = hasProtocol ? evEnabled : true;  // 如果没有选择任何协议，默认使用VLESS
        
        if (useVL) {
            finalLinks.push(...generateLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath));
        }
        if (etEnabled) {
            finalLinks.push(...await generateTrojanLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath));
        }
        if (vmEnabled) {
            finalLinks.push(...generateVMessLinksFromSource(list, user, nodeDomain, disableNonTLS, wsPath));
        }
    }

    // 原生地址
    const nativeList = [{ ip: workerDomain, isp: '原生地址' }];
    await addNodesFromList(nativeList);

    // 优选域名
    if (epd) {
        const domainList = directDomains.map(d => ({ ip: d.domain, isp: d.name || d.domain }));
        await addNodesFromList(domainList);
    }

    // 优选IP
    if (epi) {
        try {
            const dynamicIPList = await fetchDynamicIPs(ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom);
            if (dynamicIPList.length > 0) {
                await addNodesFromList(dynamicIPList);
            }
        } catch (error) {
            console.error('获取动态IP失败:', error);
        }
    }

    // GitHub优选
    if (egi) {
        try {
            const newIPList = await fetchAndParseNewIPs(piu);
            if (newIPList.length > 0) {
                // 确保至少有一个协议被启用
                const hasProtocol = evEnabled || etEnabled || vmEnabled;
                const useVL = hasProtocol ? evEnabled : true;  // 如果没有选择任何协议，默认使用VLESS
                
                if (useVL) {
                    finalLinks.push(...generateLinksFromNewIPs(newIPList, user, nodeDomain, wsPath));
                }
                // GitHub IP只支持VLESS格式
            }
        } catch (error) {
            console.error('获取GitHub IP失败:', error);
        }
    }

    if (finalLinks.length === 0) {
        const errorRemark = "所有节点获取失败";
        const errorLink = `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:80?encryption=none&security=none&type=ws&host=error.com&path=%2F#${encodeURIComponent(errorRemark)}`;
        finalLinks.push(errorLink);
    }

    let subscriptionContent;
    let contentType = 'text/plain; charset=utf-8';
    
    switch (target.toLowerCase()) {
        case 'clash':
        case 'clashr':
            subscriptionContent = generateClashConfig(finalLinks);
            contentType = 'text/yaml; charset=utf-8';
            break;
        case 'surge':
        case 'surge2':
        case 'surge3':
        case 'surge4':
            subscriptionContent = generateSurgeConfig(finalLinks);
            break;
        case 'quantumult':
        case 'quanx':
            subscriptionContent = generateQuantumultConfig(finalLinks);
            break;
        default:
            subscriptionContent = btoa(finalLinks.join('\n'));
    }
    
    return new Response(subscriptionContent, {
        headers: { 
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
    });
}

// 生成Clash配置（简化版，返回YAML格式）
function generateClashConfig(links) {
    let yaml = 'port: 7890\n';
    yaml += 'socks-port: 7891\n';
    yaml += 'allow-lan: false\n';
    yaml += 'mode: rule\n';
    yaml += 'log-level: info\n\n';
    yaml += 'proxies:\n';
    
    const proxyNames = [];
    links.forEach((link, index) => {
        const name = decodeURIComponent(link.split('#')[1] || `节点${index + 1}`);
        proxyNames.push(name);
        const server = link.match(/@([^:]+):(\d+)/)?.[1] || '';
        const port = link.match(/@[^:]+:(\d+)/)?.[1] || '443';
        const uuid = link.match(/vless:\/\/([^@]+)@/)?.[1] || '';
        const tls = link.includes('security=tls');
        const path = link.match(/path=([^&#]+)/)?.[1] || '/';
        const host = link.match(/host=([^&#]+)/)?.[1] || '';
        const sni = link.match(/sni=([^&#]+)/)?.[1] || '';
        
        yaml += `  - name: ${name}\n`;
        yaml += `    type: vless\n`;
        yaml += `    server: ${server}\n`;
        yaml += `    port: ${port}\n`;
        yaml += `    uuid: ${uuid}\n`;
        yaml += `    tls: ${tls}\n`;
        yaml += `    network: ws\n`;
        yaml += `    ws-opts:\n`;
        yaml += `      path: ${path}\n`;
        yaml += `      headers:\n`;
        yaml += `        Host: ${host}\n`;
        if (sni) {
            yaml += `    servername: ${sni}\n`;
        }
    });
    
    yaml += '\nproxy-groups:\n';
    yaml += '  - name: PROXY\n';
    yaml += '    type: select\n';
    yaml += `    proxies: [${proxyNames.map(n => `'${n}'`).join(', ')}]\n`;
    yaml += '\nrules:\n';
    yaml += '  - DOMAIN-SUFFIX,local,DIRECT\n';
    yaml += '  - IP-CIDR,127.0.0.0/8,DIRECT\n';
    yaml += '  - GEOIP,CN,DIRECT\n';
    yaml += '  - MATCH,PROXY\n';
    
    return yaml;
}

// 生成Surge配置
function generateSurgeConfig(links) {
    let config = '[Proxy]\n';
    links.forEach(link => {
        const name = decodeURIComponent(link.split('#')[1] || '节点');
        config += `${name} = vless, ${link.match(/@([^:]+):(\d+)/)?.[1] || ''}, ${link.match(/@[^:]+:(\d+)/)?.[1] || '443'}, username=${link.match(/vless:\/\/([^@]+)@/)?.[1] || ''}, tls=${link.includes('security=tls')}, ws=true, ws-path=${link.match(/path=([^&#]+)/)?.[1] || '/'}, ws-headers=Host:${link.match(/host=([^&#]+)/)?.[1] || ''}\n`;
    });
    config += '\n[Proxy Group]\nPROXY = select, ' + links.map((_, i) => decodeURIComponent(links[i].split('#')[1] || `节点${i + 1}`)).join(', ') + '\n';
    return config;
}

// 生成Quantumult配置
function generateQuantumultConfig(links) {
    return btoa(links.join('\n'));
}

// 生成现代化主页 - v2.0 升级版
function generateHomePage(scuValue) {
    const scu = scuValue || 'https://url.v1.mk/sub';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>CF 优选工具</title>
    <style>
        :root {
            --primary: #6366f1;
            --primary-hover: #4f46e5;
            --primary-light: rgba(99, 102, 241, 0.15);
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --bg-primary: #0a0a1a;
            --bg-secondary: #12122a;
            --bg-card: rgba(18, 18, 42, 0.85);
            --text-primary: #e2e8f0;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --border: rgba(148, 163, 184, 0.12);
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            line-height: 1.6;
            overflow-x: hidden;
        }
        
        .bg-effects {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: -1;
            background: 
                radial-gradient(ellipse at 20% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
                radial-gradient(ellipse at 80% 100%, rgba(139, 92, 246, 0.12) 0%, transparent 50%),
                radial-gradient(ellipse at 50% 50%, rgba(59, 130, 246, 0.08) 0%, transparent 60%);
        }
        
        .bg-grid {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: -1;
            background-image: linear-gradient(rgba(148, 163, 184, 0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(148, 163, 184, 0.03) 1px, transparent 1px);
            background-size: 60px 60px;
        }
        
        .container { max-width: 680px; margin: 0 auto; padding: 20px 16px; position: relative; }
        
        .header {
            text-align: center;
            padding: 48px 20px 36px;
        }
        
        .logo {
            width: 72px; height: 72px;
            margin: 0 auto 20px;
            background: linear-gradient(135deg, var(--primary), #8b5cf6);
            border-radius: 20px;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 16px 48px rgba(99, 102, 241, 0.35);
            animation: float 6s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
        }
        
        .logo svg { width: 36px; height: 36px; fill: white; }
        
        .header h1 {
            font-size: 30px; font-weight: 700;
            background: linear-gradient(135deg, #fff 0%, #94a3b8 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            background-clip: text; margin-bottom: 8px; letter-spacing: -0.5px;
        }
        
        .header .subtitle {
            font-size: 14px; color: var(--text-secondary);
            display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        
        .status-dot {
            width: 8px; height: 8px; background: var(--success); border-radius: 50%;
            animation: pulse 2s ease-in-out infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
            50% { opacity: 0.8; box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
        }
        
        .card {
            background: var(--bg-card);
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 24px;
            margin-bottom: 16px;
            transition: all 0.3s ease;
        }
        
        .card:hover {
            border-color: rgba(99, 102, 241, 0.25);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
        }
        
        .card-title {
            font-size: 12px; font-weight: 600; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 1.5px;
            margin-bottom: 20px; display: flex; align-items: center; gap: 10px;
        }
        
        .card-title::before {
            content: ''; width: 3px; height: 14px;
            background: linear-gradient(180deg, var(--primary), #8b5cf6);
            border-radius: 2px;
        }
        
        .form-group { margin-bottom: 18px; }
        
        .form-group label {
            display: block; font-size: 13px; font-weight: 500;
            color: var(--text-secondary); margin-bottom: 8px;
        }
        
        .form-group input {
            width: 100%; padding: 14px 16px;
            font-size: 15px; color: var(--text-primary);
            background: rgba(10, 10, 26, 0.6);
            border: 1px solid var(--border);
            border-radius: 12px; outline: none;
            transition: all 0.25s ease;
        }
        
        .form-group input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px var(--primary-light);
        }
        
        .form-group input::placeholder { color: var(--text-muted); }
        
        .form-hint { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
        
        .switch-group {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 0; border-bottom: 1px solid var(--border);
        }
        
        .switch-group:last-of-type { border-bottom: none; }
        
        .switch-group label {
            font-size: 15px; font-weight: 400; color: var(--text-primary);
            text-transform: none; letter-spacing: 0;
        }
        
        .switch {
            position: relative; width: 52px; height: 32px;
            background: rgba(148, 163, 184, 0.2);
            border-radius: 16px; cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .switch.active {
            background: linear-gradient(135deg, var(--primary), #8b5cf6);
        }
        
        .switch::after {
            content: ''; position: absolute; top: 3px; left: 3px;
            width: 26px; height: 26px; background: #fff; border-radius: 50%;
            transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        
        .switch.active::after { transform: translateX(20px); }
        
        .checkbox-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
        
        .checkbox-label {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 16px; background: rgba(10, 10, 26, 0.5);
            border: 1px solid var(--border); border-radius: 10px;
            cursor: pointer; transition: all 0.2s ease;
            font-size: 14px; font-weight: 400; color: var(--text-primary);
        }
        
        .checkbox-label:hover { border-color: var(--primary); background: var(--primary-light); }
        
        .checkbox-label input[type="checkbox"] {
            width: 18px; height: 18px; accent-color: var(--primary); cursor: pointer;
        }
        
        .client-btn {
            padding: 14px 12px; font-size: 12px; font-weight: 600;
            color: var(--text-primary); background: rgba(10, 10, 26, 0.6);
            border: 1px solid var(--border); border-radius: 12px;
            cursor: pointer; transition: all 0.25s ease;
            text-align: center; position: relative; overflow: hidden;
        }
        
        .client-btn:hover {
            border-color: var(--primary); transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(99, 102, 241, 0.2);
            background: var(--primary-light);
        }
        
        .client-btn:active { transform: translateY(0); }
        
        .result-url {
            margin-top: 16px; padding: 14px;
            background: rgba(10, 10, 26, 0.6);
            border: 1px solid var(--border); border-radius: 12px;
            font-size: 12px; color: var(--primary);
            word-break: break-all; display: none;
            animation: slideIn 0.3s ease;
        }
        
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .footer {
            text-align: center; padding: 36px 20px;
            color: var(--text-muted); font-size: 13px;
        }
        
        .footer-links {
            display: flex; justify-content: center; gap: 24px; margin-top: 16px;
        }
        
        .footer-links a {
            color: var(--text-secondary); text-decoration: none;
            transition: color 0.2s ease; display: flex; align-items: center; gap: 6px;
        }
        
        .footer-links a:hover { color: var(--primary); }
        
        .toast {
            position: fixed; bottom: 80px; left: 50%;
            transform: translateX(-50%) translateY(20px);
            padding: 14px 24px; background: var(--bg-secondary);
            border: 1px solid var(--border); border-radius: 12px;
            color: var(--text-primary); font-size: 14px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
            z-index: 1000; opacity: 0; transition: all 0.3s ease;
            pointer-events: none;
        }
        
        .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
        .toast.success { border-color: var(--success); }
        .toast.error { border-color: var(--danger); }
        
        @media (max-width: 480px) {
            .container { padding: 16px 12px; }
            .header { padding: 32px 16px 28px; }
            .header h1 { font-size: 26px; }
            .card { padding: 20px; border-radius: 16px; }
            .client-btn { padding: 12px 8px; font-size: 11px; }
        }
        
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--text-muted); border-radius: 3px; }
    </style>
</head>
<body>
    <div class="bg-effects"></div>
    <div class="bg-grid"></div>
    
    <!-- 语言切换 -->
    <div style="position: fixed; top: 16px; right: 16px; z-index: 100;">
        <button onclick="toggleLang()" style="padding: 8px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; color: var(--text-secondary); font-size: 13px; cursor: pointer;" id="langBtn">🌐 EN</button>
    </div>
    
    <div class="container">
        <div class="header">
            <div class="logo">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <h1 id="title">CF 优选工具</h1>
            <p class="subtitle">
                <span class="status-dot"></span>
                <span id="subtitle">智能优选 · 一键生成 · 多客户端</span>
            </p>
        </div>
        
        <!-- 基础配置 -->
        <div class="card">
            <div class="card-title">基础配置</div>
            <div class="form-group">
                <label>域名 / Domain</label>
                <input type="text" id="domain" placeholder="请输入您的 Worker 域名">
            </div>
            <div class="form-group">
                <label>UUID</label>
                <input type="text" id="uuid" placeholder="请输入您的 UUID">
            </div>
            <div class="form-group">
                <label>WebSocket 路径</label>
                <input type="text" id="customPath" placeholder="默认: /" value="/">
                <div class="form-hint">自定义路径，例如：/v2ray</div>
            </div>
        </div>
        
        <!-- 优选设置 -->
        <div class="card">
            <div class="card-title">优选设置</div>
            <div class="switch-group">
                <label>启用优选域名</label>
                <div class="switch active" id="switchDomain" onclick="toggleSwitch('switchDomain')"></div>
            </div>
            <div class="switch-group">
                <label>启用优选 IP</label>
                <div class="switch active" id="switchIP" onclick="toggleSwitch('switchIP')"></div>
            </div>
            <div class="switch-group">
                <label>启用 GitHub 优选</label>
                <div class="switch active" id="switchGitHub" onclick="toggleSwitch('switchGitHub')"></div>
            </div>
            <div class="form-group" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border);">
                <label>GitHub 优选 URL（可选）</label>
                <input type="text" id="githubUrl" placeholder="留空使用默认地址">
                <div class="form-hint">自定义优选 IP 列表来源</div>
            </div>
        </div>
        
        <!-- 协议选择 -->
        <div class="card">
            <div class="card-title">协议选择</div>
            <div class="switch-group">
                <label>VLESS</label>
                <div class="switch active" id="switchVL" onclick="toggleSwitch('switchVL')"></div>
            </div>
            <div class="switch-group">
                <label>Trojan</label>
                <div class="switch" id="switchTJ" onclick="toggleSwitch('switchTJ')"></div>
            </div>
            <div class="switch-group">
                <label>VMess</label>
                <div class="switch" id="switchVM" onclick="toggleSwitch('switchVM')"></div>
            </div>
            <div class="switch-group">
                <label>仅 TLS 节点</label>
                <div class="switch" id="switchTLS" onclick="toggleSwitch('switchTLS')"></div>
            </div>
            <div class="form-hint">启用后只生成 HTTPS 端口节点</div>
        </div>
        
        <!-- IP筛选 -->
        <div class="card">
            <div class="card-title">IP 筛选</div>
            <div class="form-group">
                <label>IP 版本</label>
                <div class="checkbox-grid">
                    <label class="checkbox-label">
                        <input type="checkbox" id="ipv4Enabled" checked>
                        <span>IPv4</span>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="ipv6Enabled" checked>
                        <span>IPv6</span>
                    </label>
                </div>
            </div>
            <div class="form-group">
                <label>运营商</label>
                <div class="checkbox-grid">
                    <label class="checkbox-label">
                        <input type="checkbox" id="ispMobile" checked>
                        <span>移动</span>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="ispUnicom" checked>
                        <span>联通</span>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="ispTelecom" checked>
                        <span>电信</span>
                    </label>
                </div>
            </div>
        </div>
        
        <!-- 延迟测试 -->
        <div class="card">
            <div class="card-title">⚡ 延迟测试（可选）</div>
            <div class="form-group">
                <label>IP来源</label>
                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                    <button type="button" class="client-btn" style="flex: 1;" onclick="generateCFRandomIPs()">🎲 CF随机IP</button>
                    <button type="button" class="client-btn" style="flex: 1;" onclick="fetchIPsFromURL()">📥 从URL获取</button>
                </div>
                <input type="text" id="ipUrlInput" placeholder="输入URL获取IP列表（可选）" style="margin-bottom: 8px;">
                <textarea id="testIPs" rows="3" placeholder="输入要测试的IP，多个用逗号或换行分隔&#10;示例: 1.1.1.1, 8.8.8.8:443" style="width: 100%; padding: 12px; font-size: 14px; color: var(--text-primary); background: rgba(10, 10, 26, 0.6); border: 1px solid var(--border); border-radius: 12px; outline: none; resize: vertical; font-family: monospace;"></textarea>
            </div>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 12px;">
                <label style="margin: 0; white-space: nowrap;">端口:</label>
                <input type="number" id="testPort" value="443" min="1" max="65535" style="width: 80px; padding: 10px; font-size: 14px; color: var(--text-primary); background: rgba(10, 10, 26, 0.6); border: 1px solid var(--border); border-radius: 8px; outline: none;">
                <label style="margin: 0; white-space: nowrap;">线程:</label>
                <input type="number" id="testThreads" value="5" min="1" max="20" style="width: 60px; padding: 10px; font-size: 14px; color: var(--text-primary); background: rgba(10, 10, 26, 0.6); border: 1px solid var(--border); border-radius: 8px; outline: none;">
                <button type="button" class="client-btn" style="flex: 1; background: var(--primary-light); border-color: var(--primary);" onclick="startLatencyTest()">▶ 开始测试</button>
            </div>
            <div id="testStatus" style="display: none; padding: 10px; background: rgba(10, 10, 26, 0.4); border-radius: 8px; font-size: 13px; color: var(--text-secondary); margin-bottom: 10px;"></div>
            <div id="testResults" style="display: none; max-height: 200px; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-size: 12px; color: var(--text-muted);">测试结果（点击添加到优选）</span>
                    <button type="button" style="font-size: 11px; padding: 4px 8px; background: transparent; border: 1px solid var(--border); color: var(--text-secondary); border-radius: 4px; cursor: pointer;" onclick="addSelectedToYX()">添加选中项</button>
                </div>
                <div id="resultsList"></div>
            </div>
        </div>
        
        <!-- 生成订阅 -->
        <div class="card">
            <div class="card-title">生成订阅</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px;">
                <button type="button" class="client-btn" onclick="generateClientLink('clash', 'CLASH')">CLASH</button>
                <button type="button" class="client-btn" onclick="generateClientLink('clash', 'STASH')">STASH</button>
                <button type="button" class="client-btn" onclick="generateClientLink('surge', 'SURGE')">SURGE</button>
                <button type="button" class="client-btn" onclick="generateClientLink('sing-box', 'SING-BOX')">SING-BOX</button>
                <button type="button" class="client-btn" onclick="generateClientLink('loon', 'LOON')">LOON</button>
                <button type="button" class="client-btn" onclick="generateClientLink('quanx', 'QUANX')">QUANX</button>
                <button type="button" class="client-btn" onclick="generateClientLink('v2ray', 'V2RAY')">V2RAY</button>
                <button type="button" class="client-btn" onclick="generateClientLink('v2ray', 'V2RAYNG')">V2RAYNG</button>
                <button type="button" class="client-btn" onclick="generateClientLink('v2ray', 'NEKORAY')">NEKORAY</button>
                <button type="button" class="client-btn" onclick="generateClientLink('v2ray', 'Shadowrocket')">小火箭</button>
            </div>
            <div class="result-url" id="clientSubscriptionUrl"></div>
            <button type="button" class="client-btn" id="copyBtn" style="display: none; margin-top: 12px; width: 100%; background: var(--primary-light); border-color: var(--primary);" onclick="copyCurrentUrl()">📋 复制订阅链接</button>
        </div>
        
        <div class="footer">
            <p>CF 优选工具 v2.0</p>
            <div class="footer-links">
                <a href="https://github.com/byJoey/cfnew" target="_blank">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                    GitHub
                </a>
                <a href="https://www.youtube.com/@joeyblog" target="_blank">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
                    YouTube
                </a>
            </div>
        </div>
    </div>
    
    <div class="toast" id="toast"></div>
    
    <script>
        let switches = {
            switchDomain: true,
            switchIP: true,
            switchGitHub: true,
            switchVL: true,
            switchTJ: false,
            switchVM: false,
            switchTLS: false
        };
        
        let currentUrl = '';
        let currentLang = 'zh';
        
        // 多语言文本
        const i18n = {
            zh: {
                title: 'CF 优选工具',
                subtitle: '智能优选 · 一键生成 · 多客户端',
                langBtn: '🌐 EN',
                copied: '链接已复制',
                fillRequired: '请填写域名和 UUID',
                invalidUUID: 'UUID 格式不正确',
                selectProtocol: '请至少选择一个协议',
                generated: '已生成',
                cfRandomIP: '个CF随机IP',
                fetched: '已获取',
                ips: '个IP',
                testing: '测试中',
                testDone: '测试完成',
                success: '成功',
                selected: '已选择',
                canCopy: '个IP，可复制使用',
                enterIP: '请输入要测试的IP',
                enterURL: '请输入URL',
                selectIP: '请选择要添加的IP',
                fetching: '正在获取...',
                fetchFail: '获取失败',
                noData: '未获取到IP',
                timeout: '超时',
                fail: '失败',
                stopped: '测试已停止'
            },
            en: {
                title: 'CF Preferred Tool',
                subtitle: 'Smart Selection · One-Click · Multi-Client',
                langBtn: '🌐 中文',
                copied: 'Link Copied',
                fillRequired: 'Please fill in Domain and UUID',
                invalidUUID: 'Invalid UUID format',
                selectProtocol: 'Please select at least one protocol',
                generated: 'Generated',
                cfRandomIP: 'CF Random IPs',
                fetched: 'Fetched',
                ips: 'IPs',
                testing: 'Testing',
                testDone: 'Test Complete',
                success: 'success',
                selected: 'Selected',
                canCopy: 'IPs, ready to copy',
                enterIP: 'Please enter IPs to test',
                enterURL: 'Please enter URL',
                selectIP: 'Please select IPs to add',
                fetching: 'Fetching...',
                fetchFail: 'Fetch failed',
                noData: 'No data found',
                timeout: 'Timeout',
                fail: 'Failed',
                stopped: 'Test stopped'
            }
        };
        
        function t(key) { return i18n[currentLang][key] || key; }
        
        function toggleLang() {
            currentLang = currentLang === 'zh' ? 'en' : 'zh';
            document.getElementById('title').textContent = t('title');
            document.getElementById('subtitle').textContent = t('subtitle');
            document.getElementById('langBtn').textContent = t('langBtn');
            localStorage.setItem('lang', currentLang);
        }
        
        // 初始化语言
        (function() {
            const saved = localStorage.getItem('lang');
            if (saved === 'en') {
                currentLang = 'en';
                document.getElementById('title').textContent = t('title');
                document.getElementById('subtitle').textContent = t('subtitle');
                document.getElementById('langBtn').textContent = t('langBtn');
            }
        })();
        
        function toggleSwitch(id) {
            const switchEl = document.getElementById(id);
            switches[id] = !switches[id];
            switchEl.classList.toggle('active');
        }
        
        // Toast 通知
        function showToast(message, type = 'info') {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast ' + type + ' show';
            setTimeout(() => { toast.classList.remove('show'); }, 2500);
        }
        
        // 复制当前URL
        function copyCurrentUrl() {
            if (currentUrl) {
                navigator.clipboard.writeText(currentUrl).then(() => {
                    showToast('链接已复制到剪贴板', 'success');
                });
            }
        }
        
        // 显示结果
        function showResult(url) {
            currentUrl = url;
            const urlElement = document.getElementById('clientSubscriptionUrl');
            const copyBtn = document.getElementById('copyBtn');
            urlElement.textContent = url;
            urlElement.style.display = 'block';
            copyBtn.style.display = 'block';
        }
        
        // 订阅转换地址
        const SUB_CONVERTER_URL = "${ scu }";
        
        // Cloudflare IP段
        const CF_CIDRS = [
            '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
            '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
            '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
            '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
        ];
        
        let testResults = [];
        let isTestRunning = false;
        
        // 从CIDR生成随机IP
        function randomIPFromCIDR(cidr) {
            const [base, bits] = cidr.split('/');
            const mask = 32 - parseInt(bits);
            const parts = base.split('.').map(Number);
            const ipNum = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
            const randOffset = Math.floor(Math.random() * Math.pow(2, mask));
            const newIP = ((ipNum >>> 0) & (0xFFFFFFFF << mask) >>> 0) + randOffset;
            return [(newIP >>> 24) & 255, (newIP >>> 16) & 255, (newIP >>> 8) & 255, newIP & 255].join('.');
        }
        
        // 生成CF随机IP
        function generateCFRandomIPs() {
            const count = 20;
            const port = document.getElementById('testPort').value || '443';
            const ips = [];
            for (let i = 0; i < count; i++) {
                const cidr = CF_CIDRS[Math.floor(Math.random() * CF_CIDRS.length)];
                ips.push(randomIPFromCIDR(cidr) + ':' + port);
            }
            document.getElementById('testIPs').value = ips.join('\\n');
            showToast(t('generated') + ' ' + count + ' ' + t('cfRandomIP'), 'success');
        }
        
        // 从URL获取IP
        async function fetchIPsFromURL() {
            const url = document.getElementById('ipUrlInput').value.trim();
            if (!url) {
                showToast(t('enterURL'), 'error');
                return;
            }
            try {
                showToast(t('fetching'), 'info');
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const text = await resp.text();
                const lines = text.trim().split(/[\\n,]/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                if (lines.length > 0) {
                    document.getElementById('testIPs').value = lines.slice(0, 50).join('\\n');
                    showToast(t('fetched') + ' ' + Math.min(lines.length, 50) + ' ' + t('ips'), 'success');
                } else {
                    showToast(t('noData'), 'error');
                }
            } catch (e) {
                showToast(t('fetchFail') + ': ' + e.message, 'error');
            }
        }
        
        // 测试单个IP延迟
        async function testLatency(host, port) {
            const start = Date.now();
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                await fetch('https://' + host + ':' + port + '/', {
                    method: 'HEAD',
                    mode: 'no-cors',
                    signal: controller.signal
                });
                clearTimeout(timeout);
                return { success: true, latency: Date.now() - start };
            } catch (e) {
                return { success: false, latency: -1, error: e.name === 'AbortError' ? t('timeout') : t('fail') };
            }
        }
        
        // 开始延迟测试
        async function startLatencyTest() {
            if (isTestRunning) {
                isTestRunning = false;
                showToast(t('stopped'), 'info');
                return;
            }
            
            const input = document.getElementById('testIPs').value.trim();
            if (!input) {
                showToast(t('enterIP'), 'error');
                return;
            }
            
            const defaultPort = document.getElementById('testPort').value || '443';
            const threads = parseInt(document.getElementById('testThreads').value) || 5;
            const targets = input.split(/[\\n,]/).map(s => s.trim()).filter(s => s);
            
            if (targets.length === 0) return;
            
            isTestRunning = true;
            testResults = [];
            
            const statusEl = document.getElementById('testStatus');
            const resultsEl = document.getElementById('testResults');
            const listEl = document.getElementById('resultsList');
            
            statusEl.style.display = 'block';
            resultsEl.style.display = 'block';
            listEl.innerHTML = '';
            
            const parseTarget = (t) => {
                let host = t, port = defaultPort;
                if (t.includes(':') && !t.startsWith('[')) {
                    const idx = t.lastIndexOf(':');
                    const p = t.substring(idx + 1);
                    if (/^\\d+$/.test(p)) { port = p; host = t.substring(0, idx); }
                }
                return { host, port };
            };
            
            for (let i = 0; i < targets.length; i += threads) {
                if (!isTestRunning) break;
                
                const batch = targets.slice(i, Math.min(i + threads, targets.length));
                statusEl.textContent = t('testing') + ': ' + (i + 1) + '-' + Math.min(i + threads, targets.length) + '/' + targets.length;
                
                const results = await Promise.all(batch.map(async (t) => {
                    const { host, port } = parseTarget(t);
                    const result = await testLatency(host, port);
                    return { ...result, host, port, original: t };
                }));
                
                results.forEach((r, idx) => {
                    testResults.push(r);
                    const item = document.createElement('div');
                    item.style.cssText = 'display: flex; align-items: center; padding: 8px; border-bottom: 1px solid var(--border); gap: 8px;';
                    item.innerHTML = '<input type="checkbox" ' + (r.success ? 'checked' : 'disabled') + ' style="width: 16px; height: 16px;">' +
                        '<span style="flex: 1; font-size: 13px; font-family: monospace; color: ' + (r.success ? 'var(--success)' : 'var(--danger)') + ';">' + r.host + ':' + r.port + '</span>' +
                        '<span style="font-size: 12px; color: ' + (r.success ? 'var(--warning)' : 'var(--text-muted)') + ';">' + (r.success ? r.latency + 'ms' : r.error) + '</span>';
                    listEl.appendChild(item);
                });
            }
            
            isTestRunning = false;
            statusEl.textContent = t('testDone') + ': ' + testResults.filter(r => r.success).length + '/' + testResults.length + ' ' + t('success');
        }
        
        // 添加选中项到GitHub URL字段
        function addSelectedToYX() {
            const checkboxes = document.querySelectorAll('#resultsList input[type="checkbox"]:checked');
            if (checkboxes.length === 0) {
                showToast(t('selectIP'), 'error');
                return;
            }
            const selected = [];
            checkboxes.forEach((cb, i) => {
                const items = document.querySelectorAll('#resultsList > div');
                const text = items[i]?.querySelector('span')?.textContent;
                if (text) selected.push(text);
            });
            // 添加到测试IP框以便用户复制
            showToast(t('selected') + ' ' + selected.length + ' ' + t('canCopy'), 'success');
        }
        
        function tryOpenApp(schemeUrl, fallbackCallback, timeout) {
            timeout = timeout || 2500;
            let appOpened = false;
            let callbackExecuted = false;
            const startTime = Date.now();
            
            const blurHandler = () => {
                const elapsed = Date.now() - startTime;
                if (elapsed < 3000 && !callbackExecuted) {
                    appOpened = true;
                }
            };
            
            window.addEventListener('blur', blurHandler);
            
            const hiddenHandler = () => {
                const elapsed = Date.now() - startTime;
                if (elapsed < 3000 && !callbackExecuted) {
                    appOpened = true;
                }
            };
            
            document.addEventListener('visibilitychange', hiddenHandler);
            
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.style.width = '1px';
            iframe.style.height = '1px';
            iframe.src = schemeUrl;
            document.body.appendChild(iframe);
            
            setTimeout(() => {
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                window.removeEventListener('blur', blurHandler);
                document.removeEventListener('visibilitychange', hiddenHandler);
                
                if (!callbackExecuted) {
                    callbackExecuted = true;
                    if (!appOpened && fallbackCallback) {
                        fallbackCallback();
                    }
                }
            }, timeout);
        }
        
        function generateClientLink(clientType, clientName) {
            const domain = document.getElementById('domain').value.trim();
            const uuid = document.getElementById('uuid').value.trim();
            const customPath = document.getElementById('customPath').value.trim() || '/';
            
            if (!domain || !uuid) {
                showToast(t('fillRequired'), 'error');
                return;
            }
            
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
                showToast(t('invalidUUID'), 'error');
                return;
            }
            
            // 检查至少选择一个协议
            if (!switches.switchVL && !switches.switchTJ && !switches.switchVM) {
                showToast(t('selectProtocol'), 'error');
                return;
            }
            
            const ipv4Enabled = document.getElementById('ipv4Enabled').checked;
            const ipv6Enabled = document.getElementById('ipv6Enabled').checked;
            const ispMobile = document.getElementById('ispMobile').checked;
            const ispUnicom = document.getElementById('ispUnicom').checked;
            const ispTelecom = document.getElementById('ispTelecom').checked;
            
            const githubUrl = document.getElementById('githubUrl').value.trim();
            
            const currentUrl = new URL(window.location.href);
            const baseUrl = currentUrl.origin;
            let subscriptionUrl = \`\${baseUrl}/\${uuid}/sub?domain=\${encodeURIComponent(domain)}&epd=\${switches.switchDomain ? 'yes' : 'no'}&epi=\${switches.switchIP ? 'yes' : 'no'}&egi=\${switches.switchGitHub ? 'yes' : 'no'}\`;
            
            // 添加GitHub优选URL
            if (githubUrl) {
                subscriptionUrl += \`&piu=\${encodeURIComponent(githubUrl)}\`;
            }
            
            // 添加协议选择
            if (switches.switchVL) subscriptionUrl += '&ev=yes';
            if (switches.switchTJ) subscriptionUrl += '&et=yes';
            if (switches.switchVM) subscriptionUrl += '&vm=yes';
            
            if (!ipv4Enabled) subscriptionUrl += '&ipv4=no';
            if (!ipv6Enabled) subscriptionUrl += '&ipv6=no';
            if (!ispMobile) subscriptionUrl += '&ispMobile=no';
            if (!ispUnicom) subscriptionUrl += '&ispUnicom=no';
            if (!ispTelecom) subscriptionUrl += '&ispTelecom=no';
            
            // 添加TLS控制
            if (switches.switchTLS) subscriptionUrl += '&dkby=yes';
            
            // 添加自定义路径
            if (customPath && customPath !== '/') {
                subscriptionUrl += \`&path=\${encodeURIComponent(customPath)}\`;
            }
            
            let finalUrl = subscriptionUrl;
            let schemeUrl = '';
            let displayName = clientName || '';
            
            if (clientType === 'v2ray') {
                finalUrl = subscriptionUrl;
                showResult(finalUrl);
                
                if (clientName === 'V2RAY') {
                    navigator.clipboard.writeText(finalUrl).then(() => {
                        showToast(displayName + ' 链接已复制', 'success');
                    });
                } else if (clientName === 'Shadowrocket') {
                    schemeUrl = 'shadowrocket://add/' + encodeURIComponent(finalUrl);
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            showToast(displayName + ' 链接已复制', 'success');
                        });
                    });
                } else if (clientName === 'V2RAYNG') {
                    schemeUrl = 'v2rayng://install?url=' + encodeURIComponent(finalUrl);
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            showToast(displayName + ' 链接已复制', 'success');
                        });
                    });
                } else if (clientName === 'NEKORAY') {
                    schemeUrl = 'nekoray://install-config?url=' + encodeURIComponent(finalUrl);
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            showToast(displayName + ' 链接已复制', 'success');
                        });
                    });
                }
            } else {
                const encodedUrl = encodeURIComponent(subscriptionUrl);
                finalUrl = SUB_CONVERTER_URL + '?target=' + clientType + '&url=' + encodedUrl + '&insert=false&emoji=true&list=false&xudp=false&udp=false&tfo=false&expand=true&scv=false&fdn=false&new_name=true';
                showResult(finalUrl);
                
                if (clientType === 'clash') {
                    if (clientName === 'STASH') {
                        schemeUrl = 'stash://install?url=' + encodeURIComponent(finalUrl);
                        displayName = 'STASH';
                    } else {
                        schemeUrl = 'clash://install-config?url=' + encodeURIComponent(finalUrl);
                        displayName = 'CLASH';
                    }
                } else if (clientType === 'surge') {
                    schemeUrl = 'surge:///install-config?url=' + encodeURIComponent(finalUrl);
                    displayName = 'SURGE';
                } else if (clientType === 'sing-box') {
                    schemeUrl = 'sing-box://install-config?url=' + encodeURIComponent(finalUrl);
                    displayName = 'SING-BOX';
                } else if (clientType === 'loon') {
                    schemeUrl = 'loon://install?url=' + encodeURIComponent(finalUrl);
                    displayName = 'LOON';
                } else if (clientType === 'quanx') {
                    schemeUrl = 'quantumult-x://install-config?url=' + encodeURIComponent(finalUrl);
                    displayName = 'QUANTUMULT X';
                }
                
                if (schemeUrl) {
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            showToast(displayName + ' 链接已复制', 'success');
                        });
                    });
                } else {
                    navigator.clipboard.writeText(finalUrl).then(() => {
                        showToast(displayName + ' 链接已复制', 'success');
                    });
                }
            }
        }
    </script>
</body>
</html>`;
}

// 主处理函数
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        
        // 主页
        if (path === '/' || path === '') {
            const scuValue = env?.scu || scu;
            return new Response(generateHomePage(scuValue), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        
        // 订阅请求格式: /{UUID}/sub?domain=xxx&epd=yes&epi=yes&egi=yes
        const pathMatch = path.match(/^\/([^\/]+)\/sub$/);
        if (pathMatch) {
            const uuid = pathMatch[1];
            
            if (!isValidUUID(uuid)) {
                return new Response('无效的UUID格式', { status: 400 });
            }
            
            const domain = url.searchParams.get('domain');
            if (!domain) {
                return new Response('缺少域名参数', { status: 400 });
            }
            
            // 从URL参数获取配置
            epd = url.searchParams.get('epd') !== 'no';
            epi = url.searchParams.get('epi') !== 'no';
            egi = url.searchParams.get('egi') !== 'no';
            const piu = url.searchParams.get('piu') || defaultIPURL;
            
            // 协议选择
            const evEnabled = url.searchParams.get('ev') === 'yes' || (url.searchParams.get('ev') === null && ev);
            const etEnabled = url.searchParams.get('et') === 'yes';
            const vmEnabled = url.searchParams.get('vm') === 'yes';
            
            // IPv4/IPv6选择
            const ipv4Enabled = url.searchParams.get('ipv4') !== 'no';
            const ipv6Enabled = url.searchParams.get('ipv6') !== 'no';
            
            // 运营商选择
            const ispMobile = url.searchParams.get('ispMobile') !== 'no';
            const ispUnicom = url.searchParams.get('ispUnicom') !== 'no';
            const ispTelecom = url.searchParams.get('ispTelecom') !== 'no';
            
            // TLS控制
            const disableNonTLS = url.searchParams.get('dkby') === 'yes';
            
            // 自定义路径
            const customPath = url.searchParams.get('path') || '/';
            
            return await handleSubscriptionRequest(request, uuid, domain, piu, ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath);
        }
        
        return new Response('Not Found', { status: 404 });
    }
};
