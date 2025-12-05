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

// 生成订阅内容
async function handleSubscriptionRequest(request, user, customDomain, piu, ipv4Enabled, ipv6Enabled, ispMobile, ispUnicom, ispTelecom, evEnabled, etEnabled, vmEnabled, disableNonTLS, customPath) {
    const url = new URL(request.url);
    const finalLinks = [];
    const workerDomain = url.hostname;  // workerDomain始终是请求的hostname
    const nodeDomain = customDomain || url.hostname;  // 用户输入的域名用于生成节点时的host/sni
    const target = url.searchParams.get('target') || 'base64';
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

// 生成极简白色主页
function generateHomePage(scuValue) {
    const scu = scuValue || 'https://url.v1.mk/sub';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <title>CF 优选工具</title>
    <style>
        :root {
            --primary: #000;
            --primary-hover: #333;
            --accent: #0071e3;
            --success: #30d158;
            --warning: #ff9f0a;
            --danger: #ff453a;
            --bg: #fff;
            --bg-secondary: #f5f5f7;
            --text: #1d1d1f;
            --text-secondary: #6e6e73;
            --text-muted: #86868b;
            --border: #d2d2d7;
            --border-light: #e8e8ed;
            --shadow: 0 1px 3px rgba(0,0,0,0.08);
            --shadow-lg: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }
        
        .container { max-width: 560px; margin: 0 auto; padding: 0 20px 40px; }
        
        .header {
            text-align: center;
            padding: 60px 0 40px;
            border-bottom: 1px solid var(--border-light);
            margin-bottom: 32px;
        }
        
        .header h1 {
            font-size: 32px;
            font-weight: 600;
            letter-spacing: -0.5px;
            color: var(--text);
            margin-bottom: 8px;
        }
        
        .header p {
            font-size: 15px;
            color: var(--text-muted);
            font-weight: 400;
        }
        
        .lang-btn {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 6px 12px;
            font-size: 13px;
            color: var(--text-secondary);
            background: var(--bg-secondary);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .lang-btn:hover { background: var(--border-light); }
        
        .section {
            margin-bottom: 32px;
        }
        
        .section-title {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 12px;
            padding-left: 4px;
        }
        
        .card {
            background: var(--bg);
            border: 1px solid var(--border-light);
            border-radius: 12px;
            overflow: hidden;
        }
        
        .form-row {
            padding: 14px 16px;
            border-bottom: 1px solid var(--border-light);
        }
        
        .form-row:last-child { border-bottom: none; }
        
        .form-row label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            color: var(--text);
            margin-bottom: 8px;
        }
        
        .form-row input[type="text"],
        .form-row input[type="number"],
        .form-row textarea {
            width: 100%;
            padding: 10px 12px;
            font-size: 15px;
            color: var(--text);
            background: var(--bg-secondary);
            border: 1px solid transparent;
            border-radius: 8px;
            outline: none;
            transition: all 0.2s;
        }
        
        .form-row input:focus,
        .form-row textarea:focus {
            background: var(--bg);
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(0,113,227,0.12);
        }
        
        .form-row input::placeholder,
        .form-row textarea::placeholder { color: var(--text-muted); }
        
        .form-hint {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 6px;
        }
        
        .switch-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            border-bottom: 1px solid var(--border-light);
        }
        
        .switch-row:last-child { border-bottom: none; }
        
        .switch-row span {
            font-size: 15px;
            font-weight: 400;
            color: var(--text);
        }
        
        .switch {
            position: relative;
            width: 50px;
            height: 30px;
            background: var(--border);
            border-radius: 15px;
            cursor: pointer;
            transition: background 0.25s;
        }
        
        .switch.active { background: var(--success); }
        
        .switch::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: 26px;
            height: 26px;
            background: #fff;
            border-radius: 50%;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            transition: transform 0.25s;
        }
        
        .switch.active::after { transform: translateX(20px); }
        
        .checkbox-group {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding: 14px 16px;
        }
        
        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            background: var(--bg-secondary);
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s;
            font-size: 14px;
            color: var(--text);
        }
        
        .checkbox-item:hover { background: var(--border-light); }
        
        .checkbox-item input { 
            width: 16px; height: 16px; 
            accent-color: var(--accent);
            cursor: pointer;
        }
        
        .btn-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 8px;
            padding: 16px;
        }
        
        .client-btn {
            padding: 12px 8px;
            font-size: 11px;
            font-weight: 600;
            color: var(--text);
            background: var(--bg-secondary);
            border: 1px solid var(--border-light);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            text-align: center;
        }
        
        .client-btn:hover {
            background: var(--border-light);
            border-color: var(--border);
        }
        
        .client-btn:active {
            transform: scale(0.96);
        }
        
        .result-box {
            margin: 0 16px 16px;
            padding: 12px;
            background: var(--bg-secondary);
            border-radius: 8px;
            font-size: 12px;
            font-family: 'SF Mono', Monaco, monospace;
            color: var(--text-secondary);
            word-break: break-all;
            display: none;
        }
        
        .result-box.show { display: block; }
        
        .copy-btn {
            display: none;
            width: calc(100% - 32px);
            margin: 0 16px 16px;
            padding: 12px;
            font-size: 14px;
            font-weight: 500;
            color: #fff;
            background: var(--primary);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .copy-btn:hover { background: var(--primary-hover); }
        
        .test-section {
            padding: 16px;
        }
        
        .test-header {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }
        
        .test-btn {
            flex: 1;
            padding: 10px;
            font-size: 13px;
            font-weight: 500;
            color: var(--text);
            background: var(--bg-secondary);
            border: 1px solid var(--border-light);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .test-btn:hover { background: var(--border-light); }
        
        .test-btn.primary {
            color: #fff;
            background: var(--primary);
            border-color: var(--primary);
        }
        
        .test-controls {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
            font-size: 13px;
            color: var(--text-secondary);
        }
        
        .test-controls input {
            width: 60px;
            padding: 8px;
            font-size: 13px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-light);
            border-radius: 6px;
            outline: none;
        }
        
        .test-status {
            display: none;
            padding: 10px 12px;
            background: var(--bg-secondary);
            border-radius: 8px;
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 12px;
        }
        
        .test-results {
            display: none;
            max-height: 180px;
            overflow-y: auto;
            border: 1px solid var(--border-light);
            border-radius: 8px;
        }
        
        .result-item {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            border-bottom: 1px solid var(--border-light);
            gap: 10px;
            font-size: 13px;
        }
        
        .result-item:last-child { border-bottom: none; }
        
        .result-item input { width: 16px; height: 16px; }
        
        .result-item .ip { flex: 1; font-family: 'SF Mono', Monaco, monospace; }
        
        .result-item .latency { color: var(--success); font-weight: 500; }
        .result-item .latency.fail { color: var(--danger); }
        
        .footer {
            text-align: center;
            padding: 40px 20px;
            border-top: 1px solid var(--border-light);
            margin-top: 20px;
        }
        
        .footer p {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 16px;
        }
        
        .footer-links {
            display: flex;
            justify-content: center;
            gap: 24px;
        }
        
        .footer-links a {
            font-size: 13px;
            color: var(--accent);
            text-decoration: none;
        }
        
        .footer-links a:hover { text-decoration: underline; }
        
        .toast {
            position: fixed;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            padding: 12px 24px;
            background: var(--text);
            color: #fff;
            font-size: 14px;
            border-radius: 10px;
            opacity: 0;
            transition: all 0.3s;
            z-index: 1000;
            pointer-events: none;
        }
        
        .toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        
        @media (max-width: 480px) {
            .container { padding: 0 16px 32px; }
            .header { padding: 48px 0 32px; }
            .header h1 { font-size: 28px; }
            .btn-grid { grid-template-columns: repeat(4, 1fr); gap: 6px; }
            .client-btn { padding: 10px 6px; font-size: 10px; }
        }
    </style>
</head>
<body>
    <button class="lang-btn" onclick="toggleLang()" id="langBtn">EN</button>
    
    <div class="container">
        <div class="header">
            <h1 id="title">CF 优选工具</h1>
            <p id="subtitle">智能优选 · 一键订阅</p>
        </div>
        
        <div class="section">
            <div class="section-title">基础配置</div>
            <div class="card">
                <div class="form-row">
                    <label>域名</label>
                    <input type="text" id="domain" placeholder="输入 Worker 域名">
                </div>
                <div class="form-row">
                    <label>UUID</label>
                    <input type="text" id="uuid" placeholder="输入 UUID">
                </div>
                <div class="form-row">
                    <label>WebSocket 路径</label>
                    <input type="text" id="customPath" placeholder="/" value="/">
                    <div class="form-hint">自定义路径，如 /v2ray</div>
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">优选设置</div>
            <div class="card">
                <div class="switch-row">
                    <span>优选域名</span>
                    <div class="switch active" id="switchDomain" onclick="toggleSwitch('switchDomain')"></div>
                </div>
                <div class="switch-row">
                    <span>优选 IP</span>
                    <div class="switch active" id="switchIP" onclick="toggleSwitch('switchIP')"></div>
                </div>
                <div class="switch-row">
                    <span>GitHub 优选</span>
                    <div class="switch active" id="switchGitHub" onclick="toggleSwitch('switchGitHub')"></div>
                </div>
                <div class="form-row">
                    <label>GitHub URL（可选）</label>
                    <input type="text" id="githubUrl" placeholder="留空使用默认地址">
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">协议 & 选项</div>
            <div class="card">
                <div class="switch-row">
                    <span>VLESS</span>
                    <div class="switch active" id="switchVL" onclick="toggleSwitch('switchVL')"></div>
                </div>
                <div class="switch-row">
                    <span>Trojan</span>
                    <div class="switch" id="switchTJ" onclick="toggleSwitch('switchTJ')"></div>
                </div>
                <div class="switch-row">
                    <span>VMess</span>
                    <div class="switch" id="switchVM" onclick="toggleSwitch('switchVM')"></div>
                </div>
                <div class="switch-row">
                    <span>仅 TLS</span>
                    <div class="switch" id="switchTLS" onclick="toggleSwitch('switchTLS')"></div>
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">IP 筛选</div>
            <div class="card">
                <div class="checkbox-group">
                    <label class="checkbox-item">
                        <input type="checkbox" id="ipv4Enabled" checked>
                        <span>IPv4</span>
                    </label>
                    <label class="checkbox-item">
                        <input type="checkbox" id="ipv6Enabled" checked>
                        <span>IPv6</span>
                    </label>
                    <label class="checkbox-item">
                        <input type="checkbox" id="ispMobile" checked>
                        <span>移动</span>
                    </label>
                    <label class="checkbox-item">
                        <input type="checkbox" id="ispUnicom" checked>
                        <span>联通</span>
                    </label>
                    <label class="checkbox-item">
                        <input type="checkbox" id="ispTelecom" checked>
                        <span>电信</span>
                    </label>
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">延迟测试</div>
            <div class="card">
                <div class="test-section">
                    <div class="test-header">
                        <button type="button" class="test-btn" onclick="generateCFRandomIPs()">CF 随机 IP</button>
                        <button type="button" class="test-btn" onclick="fetchIPsFromURL()">从 URL 获取</button>
                    </div>
                    <div class="form-row" style="padding: 0; border: none;">
                        <input type="text" id="ipUrlInput" placeholder="输入 IP 列表 URL" style="margin-bottom: 8px;">
                        <textarea id="testIPs" rows="2" placeholder="输入 IP 地址，多个用逗号或换行分隔" style="resize: vertical; font-family: 'SF Mono', Monaco, monospace; font-size: 13px;"></textarea>
                    </div>
                    <div class="test-controls">
                        <span>端口</span>
                        <input type="number" id="testPort" value="443">
                        <span>线程</span>
                        <input type="number" id="testThreads" value="5">
                        <button type="button" class="test-btn primary" style="flex: 1;" onclick="startLatencyTest()">开始测试</button>
                    </div>
                    <div class="test-status" id="testStatus"></div>
                    <div class="test-results" id="testResults">
                        <div id="resultsList"></div>
                    </div>
                    <button type="button" class="test-btn" style="width: 100%; margin-top: 8px; display: none;" id="addSelectedBtn" onclick="addSelectedToYX()">添加选中项</button>
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">生成订阅</div>
            <div class="card">
                <div class="btn-grid">
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
                <div class="result-box" id="clientSubscriptionUrl"></div>
                <button type="button" class="copy-btn" id="copyBtn" onclick="copyCurrentUrl()">复制订阅链接</button>
            </div>
        </div>
        
        <div class="footer">
            <p>CF 优选工具</p>
            <div class="footer-links">
                <a href="https://github.com/byJoey/cfnew" target="_blank">GitHub</a>
                <a href="https://www.youtube.com/@joeyblog" target="_blank">YouTube</a>
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
        
        const i18n = {
            zh: { title: 'CF 优选工具', subtitle: '智能优选 · 一键订阅', langBtn: 'EN' },
            en: { title: 'CF Preferred Tool', subtitle: 'Smart Selection · One-Click', langBtn: '中文' }
        };
        
        function t(key) { return i18n[currentLang][key] || key; }
        
        function toggleLang() {
            currentLang = currentLang === 'zh' ? 'en' : 'zh';
            document.getElementById('title').textContent = t('title');
            document.getElementById('subtitle').textContent = t('subtitle');
            document.getElementById('langBtn').textContent = t('langBtn');
            localStorage.setItem('lang', currentLang);
        }
        
        (function() {
            const saved = localStorage.getItem('lang');
            if (saved === 'en') {
                currentLang = 'en';
                setTimeout(() => {
                    document.getElementById('title').textContent = t('title');
                    document.getElementById('subtitle').textContent = t('subtitle');
                    document.getElementById('langBtn').textContent = t('langBtn');
                }, 0);
            }
        })();
        
        function toggleSwitch(id) {
            const switchEl = document.getElementById(id);
            switches[id] = !switches[id];
            switchEl.classList.toggle('active');
        }
        
        function showToast(message, type = 'info') {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast show';
            setTimeout(() => { toast.classList.remove('show'); }, 2500);
        }
        
        function copyCurrentUrl() {
            if (currentUrl) {
                navigator.clipboard.writeText(currentUrl).then(() => {
                    showToast('链接已复制');
                });
            }
        }
        
        function showResult(url) {
            currentUrl = url;
            const urlElement = document.getElementById('clientSubscriptionUrl');
            const copyBtn = document.getElementById('copyBtn');
            urlElement.textContent = url;
            urlElement.classList.add('show');
            copyBtn.style.display = 'block';
        }
        
        const SUB_CONVERTER_URL = "${ scu }";
        
        const CF_CIDRS = [
            '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
            '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
            '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
            '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
        ];
        
        let testResults = [];
        let isTestRunning = false;
        
        function randomIPFromCIDR(cidr) {
            const [base, bits] = cidr.split('/');
            const mask = 32 - parseInt(bits);
            const parts = base.split('.').map(Number);
            const ipNum = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
            const randOffset = Math.floor(Math.random() * Math.pow(2, mask));
            const newIP = ((ipNum >>> 0) & (0xFFFFFFFF << mask) >>> 0) + randOffset;
            return [(newIP >>> 24) & 255, (newIP >>> 16) & 255, (newIP >>> 8) & 255, newIP & 255].join('.');
        }
        
        function generateCFRandomIPs() {
            const count = 20;
            const port = document.getElementById('testPort').value || '443';
            const ips = [];
            for (let i = 0; i < count; i++) {
                const cidr = CF_CIDRS[Math.floor(Math.random() * CF_CIDRS.length)];
                ips.push(randomIPFromCIDR(cidr) + ':' + port);
            }
            document.getElementById('testIPs').value = ips.join('\\n');
            showToast('已生成 ' + count + ' 个随机IP');
        }
        
        async function fetchIPsFromURL() {
            const url = document.getElementById('ipUrlInput').value.trim();
            if (!url) { showToast('请输入URL'); return; }
            try {
                showToast('正在获取...');
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const text = await resp.text();
                const lines = text.trim().split(/[\\n,]/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                if (lines.length > 0) {
                    document.getElementById('testIPs').value = lines.slice(0, 50).join('\\n');
                    showToast('已获取 ' + Math.min(lines.length, 50) + ' 个IP');
                } else {
                    showToast('未获取到数据');
                }
            } catch (e) {
                showToast('获取失败: ' + e.message);
            }
        }
        
        async function testLatency(host, port) {
            const start = Date.now();
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                await fetch('https://' + host + ':' + port + '/', { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
                clearTimeout(timeout);
                return { success: true, latency: Date.now() - start };
            } catch (e) {
                return { success: false, latency: -1, error: e.name === 'AbortError' ? '超时' : '失败' };
            }
        }
        
        async function startLatencyTest() {
            if (isTestRunning) { isTestRunning = false; showToast('测试已停止'); return; }
            const input = document.getElementById('testIPs').value.trim();
            if (!input) { showToast('请输入IP'); return; }
            
            const defaultPort = document.getElementById('testPort').value || '443';
            const threads = parseInt(document.getElementById('testThreads').value) || 5;
            const targets = input.split(/[\\n,]/).map(s => s.trim()).filter(s => s);
            if (targets.length === 0) return;
            
            isTestRunning = true;
            testResults = [];
            
            const statusEl = document.getElementById('testStatus');
            const resultsEl = document.getElementById('testResults');
            const listEl = document.getElementById('resultsList');
            const addBtn = document.getElementById('addSelectedBtn');
            
            statusEl.style.display = 'block';
            resultsEl.style.display = 'block';
            addBtn.style.display = 'block';
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
                statusEl.textContent = '测试中: ' + (i + 1) + '-' + Math.min(i + threads, targets.length) + '/' + targets.length;
                
                const results = await Promise.all(batch.map(async (t) => {
                    const { host, port } = parseTarget(t);
                    const result = await testLatency(host, port);
                    return { ...result, host, port, original: t };
                }));
                
                results.forEach((r) => {
                    testResults.push(r);
                    const item = document.createElement('div');
                    item.className = 'result-item';
                    item.innerHTML = '<input type="checkbox" ' + (r.success ? 'checked' : 'disabled') + '>' +
                        '<span class="ip">' + r.host + ':' + r.port + '</span>' +
                        '<span class="latency' + (r.success ? '' : ' fail') + '">' + (r.success ? r.latency + 'ms' : r.error) + '</span>';
                    listEl.appendChild(item);
                });
            }
            
            isTestRunning = false;
            statusEl.textContent = '完成: ' + testResults.filter(r => r.success).length + '/' + testResults.length + ' 成功';
        }
        
        function addSelectedToYX() {
            const checkboxes = document.querySelectorAll('#resultsList input[type="checkbox"]:checked');
            if (checkboxes.length === 0) { showToast('请选择IP'); return; }
            showToast('已选择 ' + checkboxes.length + ' 个IP');
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
                showToast('请填写域名和UUID');
                return;
            }
            
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
                showToast('UUID格式不正确');
                return;
            }
            
            // 检查至少选择一个协议
            if (!switches.switchVL && !switches.switchTJ && !switches.switchVM) {
                showToast('请至少选择一个协议');
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
                        showToast(displayName + ' 链接已复制');
                    });
                } else if (clientName === 'Shadowrocket') {
                    schemeUrl = 'shadowrocket://add/' + encodeURIComponent(finalUrl);
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            showToast(displayName + ' 链接已复制');
                        });
                    });
                } else if (clientName === 'V2RAYNG') {
                    schemeUrl = 'v2rayng://install?url=' + encodeURIComponent(finalUrl);
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            showToast(displayName + ' 链接已复制');
                        });
                    });
                } else if (clientName === 'NEKORAY') {
                    schemeUrl = 'nekoray://install-config?url=' + encodeURIComponent(finalUrl);
                    tryOpenApp(schemeUrl, () => {
                        navigator.clipboard.writeText(finalUrl).then(() => {
                            showToast(displayName + ' 链接已复制');
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
                            showToast(displayName + ' 链接已复制');
                        });
                    });
                } else {
                    navigator.clipboard.writeText(finalUrl).then(() => {
                        showToast(displayName + ' 链接已复制');
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
