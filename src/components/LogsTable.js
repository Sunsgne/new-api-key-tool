import React, { useState, useMemo } from 'react';
import {
    Button,
    Input,
    Typography,
    Table,
    Tag,
    Spin,
    Card,
    Collapse,
    Toast,
    Space,
    Select,
    DatePicker,
    Modal,
    Tooltip,
    Empty,
    Banner,
    RadioGroup,
    Radio,
} from '@douyinfe/semi-ui';
import {
    IconSearch,
    IconDownload,
    IconPlus,
    IconRefresh,
    IconClose,
} from '@douyinfe/semi-icons';
import { API } from '../helpers';
import { stringToColor, renderModelPrice, renderQuota } from '../helpers/render';
import { ITEMS_PER_PAGE } from '../constants';
import {
    TOKEN_REGEX,
    startOfDay,
    endOfDay,
    toUnixSeconds,
    getDatePresets,
    aggregateLogsByDay,
    maskToken,
} from '../helpers/usage';
import { timestamp2string } from '../helpers';
import Paragraph from '@douyinfe/semi-ui/lib/es/typography/paragraph';
import Papa from 'papaparse';

const { Text } = Typography;
const { Panel } = Collapse;

const SHOW_BALANCE = process.env.REACT_APP_SHOW_BALANCE === 'true';
const SHOW_DETAIL = process.env.REACT_APP_SHOW_DETAIL === 'true';
// NewAPI GetPageQuery 对 page_size 的硬上限为 100，传更大也会被截断
const PAGE_SIZE = 100;
const WINDOW_SECONDS = 86400; // 按天切窗拉取日志，避免深度 OFFSET 慢查询（结果与不切窗一致）
const WINDOW_CONCURRENCY = 4; // 窗口并发数

function renderTimestamp(timestamp) {
    return timestamp2string(timestamp);
}

function renderIsStream(bool) {
    return bool ? (
        <Tag color="blue" size="large">流</Tag>
    ) : (
        <Tag color="purple" size="large">非流</Tag>
    );
}

function renderUseTime(type) {
    const time = parseInt(type);
    if (time < 101) {
        return <Tag color="green" size="large"> {time} 秒 </Tag>;
    } else if (time < 300) {
        return <Tag color="orange" size="large"> {time} 秒 </Tag>;
    }
    return <Tag color="red" size="large"> {time} 秒 </Tag>;
}

async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            Toast.success('已复制：' + text);
            return;
        }
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            textArea.remove();
            Toast.success('已复制：' + text);
        } catch (err) {
            textArea.remove();
            Modal.error({ title: '无法复制到剪贴板，请手动复制', content: text });
        }
    } catch (err) {
        Modal.error({ title: '无法复制到剪贴板，请手动复制', content: text });
    }
}

function downloadCSV(rows, filename) {
    if (!rows || rows.length === 0) {
        Toast.warning('暂无可导出的数据');
        return;
    }
    const csvString = '\ufeff' + Papa.unparse(rows);
    try {
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        if (
            navigator.userAgent.indexOf('Safari') > -1 &&
            navigator.userAgent.indexOf('Chrome') === -1
        ) {
            link.target = '_blank';
        }
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (err) {
        Toast.error('导出失败，请稍后重试');
    }
}

function extractItems(d) {
    return Array.isArray(d) ? d : (d && (d.items || d.records)) || [];
}

// 串行分页（用于数据量较小的接口，如令牌列表）
async function fetchAllPages(url, baseParams, headers) {
    let page = 1;
    let all = [];
    let total = Infinity;
    let guard = 0;
    while (all.length < total && guard < 5000) {
        guard++;
        const res = await API.get(url, {
            params: { ...baseParams, p: page, page_size: PAGE_SIZE },
            headers,
        });
        const body = res && res.data;
        if (!body || !body.success) break;
        const d = body.data || {};
        const items = extractItems(d);
        total = d && typeof d.total === 'number' ? d.total : items.length;
        all = all.concat(items);
        if (items.length === 0) break;
        page += 1;
    }
    return all;
}

// 明细日志拉取：按时间窗口切分（每窗 OFFSET 受单窗行数限制，避免深度 OFFSET 慢查询），
// 窗口之间用有限并发；拉取该时间范围内的全部日志（不截断）。
async function fetchLogsByWindows(url, baseParams, headers, startTs, endTs) {
    const windows = [];
    for (let s = startTs; s <= endTs; s += WINDOW_SECONDS) {
        windows.push([s, Math.min(s + WINDOW_SECONDS - 1, endTs)]);
    }
    const all = [];
    let idx = 0;

    const worker = async () => {
        while (idx < windows.length) {
            const myIdx = idx;
            idx += 1;
            const [ws, we] = windows[myIdx];
            let page = 1;
            while (true) {
                const res = await API.get(url, {
                    params: {
                        ...baseParams,
                        start_timestamp: ws,
                        end_timestamp: we,
                        p: page,
                        page_size: PAGE_SIZE,
                    },
                    headers,
                });
                const b = res && res.data;
                if (!b || !b.success) break;
                const items = extractItems(b.data || {});
                for (const it of items) all.push(it);
                if (items.length < PAGE_SIZE) break;
                page += 1;
            }
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(WINDOW_CONCURRENCY, windows.length) }, worker),
    );
    return all;
}

const LogsTable = () => {
    // 查询方式：access（访问令牌，支持时间范围内全量）/ key（令牌 Key，最多最近 1000 条）
    const [queryType, setQueryType] = useState('access');

    // access 模式凭证
    const [accessToken, setAccessToken] = useState('');
    const [userId, setUserId] = useState('');

    // key 模式凭证
    const [tokens, setTokens] = useState([]);
    const [tokenInput, setTokenInput] = useState('');

    // 查询条件
    const [dateRange, setDateRange] = useState([
        startOfDay((() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; })()),
        endOfDay(new Date()),
    ]);
    const [queryMode, setQueryMode] = useState('daily'); // daily | detail（仅视图切换，数据同源）
    const [modelFilter, setModelFilter] = useState('all');

    // 结果
    const [loading, setLoading] = useState(false);
    const [tokenInfos, setTokenInfos] = useState([]);
    const [logs, setLogs] = useState([]);
    const [activeKeys, setActiveKeys] = useState([]);
    const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);
    const [capWarning, setCapWarning] = useState(false);

    const presets = useMemo(() => getDatePresets(), []);

    const addToken = (value) => {
        const v = (value || '').trim();
        if (!v) return;
        if (!TOKEN_REGEX.test(v)) {
            Toast.error('令牌格式非法！应为 sk- 开头的 51 位字符');
            return;
        }
        if (tokens.includes(v)) {
            Toast.warning('该令牌已添加');
            return;
        }
        setTokens((prev) => [...prev, v]);
        setTokenInput('');
    };

    const removeToken = (value) => {
        setTokens((prev) => prev.filter((t) => t !== value));
    };

    const resetFilters = () => {
        setDateRange([
            startOfDay((() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; })()),
            endOfDay(new Date()),
        ]);
        setQueryMode('daily');
        setModelFilter('all');
    };

    // ====== access 模式：访问令牌 + 用户ID（按日/按条同源，均来自原始日志，含令牌名称） ======
    const fetchByAccessToken = async (startTs, endTs) => {
        const headers = {
            Authorization: `Bearer ${accessToken.trim()}`,
            'New-Api-User': userId.trim(),
        };

        const infos = [];
        if (SHOW_BALANCE) {
            try {
                const tokenList = await fetchAllPages('/api/token/', {}, headers);
                tokenList.forEach((t) => {
                    infos.push({
                        token: t.key ? (t.key.startsWith('sk-') ? t.key : `sk-${t.key}`) : '',
                        name: t.name,
                        unlimitedQuota: t.unlimited_quota,
                        totalGranted: (t.remain_quota || 0) + (t.used_quota || 0),
                        totalUsed: t.used_quota || 0,
                        totalAvailable: t.remain_quota || 0,
                        expiresAt: t.expired_time === -1 ? 0 : t.expired_time,
                        valid: t.status === 1,
                    });
                });
            } catch (e) {
                // 令牌列表失败不阻断日志查询
            }
        }

        let allLogs = [];
        if (SHOW_DETAIL) {
            allLogs = await fetchLogsByWindows(
                '/api/log/self',
                { type: 2 },
                headers,
                startTs,
                endTs,
            );
        }
        return { infos, logs: allLogs, capped: false };
    };

    // ====== key 模式：令牌 Key（最多最近 1000 条，无法按时间过滤，客户端再过滤） ======
    const fetchByTokenKey = async (startTs, endTs) => {
        const infos = [];
        let allLogs = [];
        let capped = false;

        for (const tk of tokens) {
            if (SHOW_BALANCE) {
                try {
                    const usageRes = await API.get('/api/usage/token/', {
                        headers: { Authorization: `Bearer ${tk}` },
                    });
                    const usageData = usageRes && usageRes.data;
                    if (usageData && usageData.code) {
                        const d = usageData.data;
                        infos.push({
                            token: tk,
                            name: d.name,
                            unlimitedQuota: d.unlimited_quota,
                            totalGranted: d.total_granted,
                            totalUsed: d.total_used,
                            totalAvailable: d.total_available,
                            expiresAt: d.expires_at,
                            valid: true,
                        });
                    } else {
                        infos.push({ token: tk, valid: false, error: (usageData && usageData.message) || '查询失败' });
                    }
                } catch (e) {
                    infos.push({ token: tk, valid: false, error: '查询失败' });
                }
            }

            if (SHOW_DETAIL) {
                try {
                    const logRes = await API.get('/api/log/token', {
                        headers: { Authorization: `Bearer ${tk}` },
                    });
                    const body = logRes && logRes.data;
                    if (body && body.success && Array.isArray(body.data)) {
                        if (body.data.length >= 1000) capped = true;
                        allLogs = allLogs.concat(body.data.map((l) => ({ ...l, _token: tk })));
                    }
                } catch (e) {
                    // 单令牌失败不影响其它
                }
            }
        }

        // 服务端不支持时间过滤，这里做客户端过滤
        allLogs = allLogs.filter(
            (l) => l.created_at >= startTs && l.created_at <= endTs,
        );
        return { infos, logs: allLogs, capped };
    };

    const fetchData = async () => {
        if (!dateRange || !dateRange[0] || !dateRange[1]) {
            Toast.warning('请选择查询日期范围');
            return;
        }
        if (queryType === 'access') {
            if (!accessToken.trim()) {
                Toast.warning('请输入访问令牌（Access Token）');
                return;
            }
            if (!userId.trim()) {
                Toast.warning('请输入用户 ID');
                return;
            }
        } else {
            if (tokens.length === 0) {
                Toast.warning('请先添加要查询的令牌');
                return;
            }
        }

        const startTs = toUnixSeconds(startOfDay(dateRange[0]));
        const endTs = toUnixSeconds(endOfDay(dateRange[1]));

        setLoading(true);
        setCapWarning(false);
        try {
            const { infos, logs: allLogs, capped } =
                queryType === 'access'
                    ? await fetchByAccessToken(startTs, endTs)
                    : await fetchByTokenKey(startTs, endTs);

            allLogs.sort((a, b) => b.created_at - a.created_at);
            setTokenInfos(infos);
            setLogs(allLogs);
            setCapWarning(capped);

            const keys = [];
            if (SHOW_BALANCE) keys.push('1');
            if (SHOW_DETAIL) keys.push('2');
            setActiveKeys(keys);
            setModelFilter('all');

            if (infos.filter((i) => i.valid).length === 0 && allLogs.length === 0) {
                Toast.error('未查询到数据，请检查凭证、用户 ID 或日期范围是否正确');
            }
        } catch (e) {
            Toast.error('查询失败，请检查凭证或上游站点是否可达');
        }
        setLoading(false);
    };

    // 模型筛选选项
    const modelOptions = useMemo(() => {
        const set = new Set();
        logs.forEach((l) => l.model_name && set.add(l.model_name));
        return [
            { value: 'all', label: '全部模型' },
            ...Array.from(set).sort().map((m) => ({ value: m, label: m })),
        ];
    }, [logs]);

    const filteredLogs = useMemo(
        () => logs.filter((l) => modelFilter === 'all' || l.model_name === modelFilter),
        [logs, modelFilter],
    );

    const dailyRows = useMemo(() => aggregateLogsByDay(filteredLogs), [filteredLogs]);

    const totalQuotaSpent = useMemo(
        () => filteredLogs.reduce((sum, l) => sum + (l.quota || 0), 0),
        [filteredLogs],
    );

    const detailCount = queryMode === 'daily' ? dailyRows.length : filteredLogs.length;
    const hasDetailData = filteredLogs.length > 0;

    // ====== 列定义 ======
    const detailColumns = [
        {
            title: '时间',
            dataIndex: 'created_at',
            render: renderTimestamp,
            sorter: (a, b) => a.created_at - b.created_at,
            defaultSortOrder: 'descend',
        },
        {
            title: '令牌名称',
            dataIndex: 'token_name',
            render: (text) =>
                text ? (
                    <Tag color="grey" size="large" onClick={() => copyText(text)}>{text}</Tag>
                ) : null,
            sorter: (a, b) => ('' + a.token_name).localeCompare(b.token_name),
        },
        {
            title: '模型',
            dataIndex: 'model_name',
            render: (text) =>
                text ? (
                    <Tag color={stringToColor(text)} size="large" onClick={() => copyText(text)}>{text}</Tag>
                ) : null,
            sorter: (a, b) => ('' + a.model_name).localeCompare(b.model_name),
        },
        {
            title: '用时',
            dataIndex: 'use_time',
            render: (text, record) =>
                record.model_name && record.model_name.startsWith('mj_') ? null : (
                    <Space>
                        {renderUseTime(text)}
                        {renderIsStream(record.is_stream)}
                    </Space>
                ),
            sorter: (a, b) => a.use_time - b.use_time,
        },
        {
            title: '提示',
            dataIndex: 'prompt_tokens',
            sorter: (a, b) => a.prompt_tokens - b.prompt_tokens,
        },
        {
            title: '补全',
            dataIndex: 'completion_tokens',
            sorter: (a, b) => a.completion_tokens - b.completion_tokens,
        },
        {
            title: '花费',
            dataIndex: 'quota',
            render: (text) => renderQuota(text, 6),
            sorter: (a, b) => a.quota - b.quota,
        },
        {
            title: '详情',
            dataIndex: 'content',
            render: (text, record) => {
                let other = null;
                try {
                    other = JSON.parse(record.other === '' ? '{}' : record.other);
                } catch (e) {
                    return (
                        <Tooltip content="该版本不支持显示计算详情">
                            <Paragraph ellipsis={{ rows: 2 }}>{text}</Paragraph>
                        </Tooltip>
                    );
                }
                if (!other) return <Paragraph ellipsis={{ rows: 2 }}>{text}</Paragraph>;
                const content = renderModelPrice(
                    record.prompt_tokens,
                    record.completion_tokens,
                    other.model_ratio,
                    other.model_price,
                    other.completion_ratio,
                    other.group_ratio,
                );
                return (
                    <Tooltip content={content}>
                        <Paragraph ellipsis={{ rows: 2 }}>{text}</Paragraph>
                    </Tooltip>
                );
            },
        },
    ];

    const dailyColumns = [
        {
            title: '日期',
            dataIndex: 'date',
            sorter: (a, b) => ('' + a.date).localeCompare(b.date),
            defaultSortOrder: 'descend',
        },
        {
            title: '令牌名称',
            dataIndex: 'token_name',
            render: (text) =>
                text ? <Tag color="grey" size="large">{text}</Tag> : <Text type="tertiary">-</Text>,
            sorter: (a, b) => ('' + a.token_name).localeCompare(b.token_name),
        },
        {
            title: '模型',
            dataIndex: 'model_name',
            render: (text) =>
                text ? (
                    <Tag color={stringToColor(text)} size="large" onClick={() => copyText(text)}>{text}</Tag>
                ) : null,
            sorter: (a, b) => ('' + a.model_name).localeCompare(b.model_name),
        },
        { title: '调用次数', dataIndex: 'count', sorter: (a, b) => a.count - b.count },
        { title: '提示 Tokens', dataIndex: 'prompt_tokens', sorter: (a, b) => a.prompt_tokens - b.prompt_tokens },
        { title: '补全 Tokens', dataIndex: 'completion_tokens', sorter: (a, b) => a.completion_tokens - b.completion_tokens },
        { title: '花费', dataIndex: 'quota', render: (t) => renderQuota(t, 6), sorter: (a, b) => a.quota - b.quota },
    ];

    const tokenInfoColumns = [
        { title: '令牌', dataIndex: 'token', render: (t) => <Text type="tertiary">{t ? maskToken(t) : '-'}</Text> },
        { title: '名称', dataIndex: 'name', render: (t) => t || '未知' },
        {
            title: '状态',
            dataIndex: 'valid',
            render: (valid) => (valid ? <Tag color="green">有效</Tag> : <Tag color="red">无效</Tag>),
        },
        { title: '总额', dataIndex: 'totalGranted', render: (t, r) => (!r.valid ? '未知' : r.unlimitedQuota ? '无限' : renderQuota(r.totalGranted, 3)) },
        { title: '剩余额度', dataIndex: 'totalAvailable', render: (t, r) => (!r.valid ? '未知' : r.unlimitedQuota ? '无限制' : renderQuota(r.totalAvailable, 3)) },
        { title: '已用额度', dataIndex: 'totalUsed', render: (t, r) => (!r.valid ? '未知' : r.unlimitedQuota ? '不计算' : renderQuota(r.totalUsed, 3)) },
        { title: '有效期至', dataIndex: 'expiresAt', render: (t, r) => (!r.valid ? '未知' : r.expiresAt === 0 ? '永不过期' : renderTimestamp(r.expiresAt)) },
    ];

    const exportTokenInfoCSV = (e) => {
        e && e.stopPropagation();
        const rows = tokenInfos.map((i) => ({
            令牌: i.token ? maskToken(i.token) : '-',
            名称: i.name || '未知',
            状态: i.valid ? '有效' : '无效',
            总额: i.valid ? (i.unlimitedQuota ? '无限' : renderQuota(i.totalGranted, 3)) : '未知',
            剩余: i.valid ? (i.unlimitedQuota ? '无限制' : renderQuota(i.totalAvailable, 3)) : '未知',
            已用: i.valid ? (i.unlimitedQuota ? '不计算' : renderQuota(i.totalUsed, 3)) : '未知',
            有效期至: i.valid ? (i.expiresAt === 0 ? '永不过期' : renderTimestamp(i.expiresAt)) : '未知',
        }));
        downloadCSV(rows, 'token-info.csv');
    };

    const exportDetailCSV = (e) => {
        e && e.stopPropagation();
        if (queryMode === 'daily') {
            const rows = dailyRows.map((r) => ({
                日期: r.date,
                令牌名称: r.token_name,
                模型: r.model_name,
                调用次数: r.count,
                '提示 Tokens': r.prompt_tokens,
                '补全 Tokens': r.completion_tokens,
                花费: renderQuota(r.quota, 6),
            }));
            downloadCSV(rows, 'usage-daily.csv');
        } else {
            const rows = filteredLogs.map((l) => ({
                时间: renderTimestamp(l.created_at),
                令牌名称: l.token_name,
                模型: l.model_name,
                用时: l.use_time,
                提示: l.prompt_tokens,
                补全: l.completion_tokens,
                花费: renderQuota(l.quota, 6),
                详情: l.content,
            }));
            downloadCSV(rows, 'usage-detail.csv');
        }
    };

    return (
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
            <Card>
                <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ marginRight: 12 }}>查询方式：</Text>
                    <RadioGroup
                        type="button"
                        value={queryType}
                        onChange={(e) => setQueryType(e.target.value)}
                    >
                        <Radio value="access">访问令牌（可查时间范围内全量）</Radio>
                        <Radio value="key">令牌 Key（仅最近 1000 条）</Radio>
                    </RadioGroup>
                </div>

                {queryType === 'access' ? (
                    <Space wrap align="center" style={{ width: '100%' }}>
                        <Input
                            value={accessToken}
                            onChange={setAccessToken}
                            mode="password"
                            placeholder="访问令牌 Access Token（NewAPI 个人设置中生成）"
                            prefix={<IconSearch />}
                            style={{ width: 460, maxWidth: '100%' }}
                        />
                        <Input
                            value={userId}
                            onChange={setUserId}
                            placeholder="用户 ID"
                            style={{ width: 160 }}
                        />
                    </Space>
                ) : (
                    <>
                        <Space style={{ width: '100%' }} align="center" wrap>
                            <Input
                                showClear
                                value={tokenInput}
                                onChange={setTokenInput}
                                placeholder="请输入令牌 sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                prefix={<IconSearch />}
                                style={{ width: 520, maxWidth: '100%' }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') addToken(tokenInput);
                                }}
                            />
                            <Button icon={<IconPlus />} theme="solid" type="primary" onClick={() => addToken(tokenInput)}>
                                添加
                            </Button>
                        </Space>
                        {tokens.length > 0 && (
                            <div style={{ marginTop: 12 }}>
                                <Space wrap>
                                    {tokens.map((t) => (
                                        <Tag key={t} color="blue" size="large" closable onClose={() => removeToken(t)}>
                                            {maskToken(t)}
                                        </Tag>
                                    ))}
                                    <Button size="small" theme="borderless" type="danger" icon={<IconClose />} onClick={() => setTokens([])}>
                                        清空
                                    </Button>
                                </Space>
                            </div>
                        )}
                    </>
                )}

                {/* 筛选条件 */}
                <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div>
                        <Text type="secondary" style={{ marginRight: 6 }}>日期范围：</Text>
                        <DatePicker
                            type="dateRange"
                            value={dateRange}
                            onChange={(v) => setDateRange(v)}
                            presets={presets}
                            density="compact"
                            style={{ width: 280 }}
                        />
                    </div>
                    <div>
                        <Text type="secondary" style={{ marginRight: 6 }}>查询模式：</Text>
                        <Select
                            value={queryMode}
                            onChange={(v) => setQueryMode(v)}
                            style={{ width: 130 }}
                            optionList={[
                                { value: 'daily', label: '按日查询' },
                                { value: 'detail', label: '按条查询' },
                            ]}
                        />
                    </div>
                    {SHOW_DETAIL && modelOptions.length > 1 && (
                        <div>
                            <Text type="secondary" style={{ marginRight: 6 }}>模型：</Text>
                            <Select
                                value={modelFilter}
                                onChange={(v) => setModelFilter(v)}
                                style={{ width: 200 }}
                                optionList={modelOptions}
                                filter
                            />
                        </div>
                    )}
                    <Button theme="solid" type="primary" icon={<IconSearch />} loading={loading} onClick={fetchData}>
                        查询
                    </Button>
                    <Button theme="light" icon={<IconRefresh />} onClick={resetFilters}>
                        重置筛选
                    </Button>
                </div>

                {/* 快捷区间标签 */}
                <div style={{ marginTop: 10 }}>
                    <Space wrap>
                        {presets.map((p) => (
                            <Tag
                                key={p.text}
                                color="light-blue"
                                style={{ cursor: 'pointer' }}
                                onClick={() => setDateRange([new Date(p.start), new Date(p.end)])}
                            >
                                {p.text}
                            </Tag>
                        ))}
                    </Space>
                </div>

                {queryType === 'key' && (
                    <Banner
                        type="warning"
                        closeIcon={null}
                        style={{ marginTop: 14 }}
                        description="「令牌 Key」方式受 NewAPI 接口限制，仅能返回每个令牌最近 1000 条记录且不支持服务端按时间过滤（此处为客户端过滤）。如需查询时间范围内的全部记录，请切换到「访问令牌」方式。"
                    />
                )}
                {capWarning && queryType === 'key' && (
                    <Banner
                        type="danger"
                        closeIcon={null}
                        style={{ marginTop: 10 }}
                        description="检测到有令牌返回的记录已达 1000 条上限，结果可能不完整。请改用「访问令牌」方式以获取时间范围内的全量数据。"
                    />
                )}
            </Card>

            <Card style={{ marginTop: 24 }}>
                <Collapse activeKey={activeKeys} onChange={(keys) => setActiveKeys(keys)}>
                    {SHOW_BALANCE && (
                        <Panel
                            header="令牌信息"
                            itemKey="1"
                            extra={
                                <Button icon={<IconDownload />} theme="borderless" type="primary" onClick={exportTokenInfoCSV} disabled={tokenInfos.length === 0}>
                                    令牌信息导出为CSV文件
                                </Button>
                            }
                        >
                            <Spin spinning={loading}>
                                {tokenInfos.length === 0 ? (
                                    <Empty description="暂无数据，请查询后查看" style={{ padding: 24 }} />
                                ) : (
                                    <Table columns={tokenInfoColumns} dataSource={tokenInfos} rowKey={(r) => r.token || r.name} pagination={false} size="small" />
                                )}
                            </Spin>
                        </Panel>
                    )}

                    {SHOW_DETAIL && (
                        <Panel
                            header="调用详情"
                            itemKey="2"
                            extra={
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Tag shape="circle" color="green">汇总花费：{renderQuota(totalQuotaSpent, 4)}</Tag>
                                    <Tag shape="circle" color="blue">共 {detailCount} 条</Tag>
                                    <Button icon={<IconDownload />} theme="borderless" type="primary" onClick={exportDetailCSV} disabled={!hasDetailData}>
                                        调用详情导出为CSV文件
                                    </Button>
                                </div>
                            }
                        >
                            <Spin spinning={loading}>
                                {!hasDetailData ? (
                                    <Empty description="暂无数据，请查询后查看" style={{ padding: 24 }} />
                                ) : queryMode === 'daily' ? (
                                    <Table
                                        columns={dailyColumns}
                                        dataSource={dailyRows}
                                        rowKey="key"
                                        pagination={{
                                            pageSize,
                                            hideOnSinglePage: true,
                                            showSizeChanger: true,
                                            pageSizeOpts: [10, 20, 50, 100],
                                            onPageSizeChange: setPageSize,
                                            showTotal: (total) => `共 ${total} 条`,
                                            showQuickJumper: true,
                                            total: dailyRows.length,
                                        }}
                                    />
                                ) : (
                                    <Table
                                        columns={detailColumns}
                                        dataSource={filteredLogs}
                                        rowKey={(r) => r.id || `${r.token_name}-${r.created_at}-${Math.random()}`}
                                        pagination={{
                                            pageSize,
                                            hideOnSinglePage: true,
                                            showSizeChanger: true,
                                            pageSizeOpts: [10, 20, 50, 100],
                                            onPageSizeChange: setPageSize,
                                            showTotal: (total) => `共 ${total} 条`,
                                            showQuickJumper: true,
                                            total: filteredLogs.length,
                                        }}
                                    />
                                )}
                            </Spin>
                        </Panel>
                    )}
                </Collapse>
            </Card>
        </div>
    );
};

export default LogsTable;
