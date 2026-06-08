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
} from '@douyinfe/semi-ui';
import {
    IconSearch,
    IconDownload,
    IconPlus,
    IconImport,
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

const LogsTable = () => {
    const baseUrls = useMemo(() => {
        try {
            return JSON.parse(process.env.REACT_APP_BASE_URL);
        } catch (e) {
            return {};
        }
    }, []);
    const siteKeys = Object.keys(baseUrls);

    const [siteKey, setSiteKey] = useState(siteKeys[0] || '');
    const baseUrl = baseUrls[siteKey] || '';

    // 令牌管理
    const [tokens, setTokens] = useState([]);
    const [tokenInput, setTokenInput] = useState('');

    // 查询条件
    const [dateRange, setDateRange] = useState([startOfDay(new Date()), endOfDay(new Date())]);
    const [queryMode, setQueryMode] = useState('daily'); // daily | detail
    const [modelFilter, setModelFilter] = useState('all');

    // 结果
    const [loading, setLoading] = useState(false);
    const [tokenInfos, setTokenInfos] = useState([]);
    const [logs, setLogs] = useState([]);
    const [activeKeys, setActiveKeys] = useState([]);
    const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);

    // 从用户名导入
    const [importVisible, setImportVisible] = useState(false);
    const [importUsername, setImportUsername] = useState('');
    const [importAccessToken, setImportAccessToken] = useState('');
    const [importing, setImporting] = useState(false);

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
        setDateRange([startOfDay(new Date()), endOfDay(new Date())]);
        setQueryMode('daily');
        setModelFilter('all');
    };

    const fetchData = async () => {
        if (tokens.length === 0) {
            Toast.warning('请先添加要查询的令牌');
            return;
        }
        if (!dateRange || !dateRange[0] || !dateRange[1]) {
            Toast.warning('请选择查询日期范围');
            return;
        }
        const startTs = toUnixSeconds(startOfDay(dateRange[0]));
        const endTs = toUnixSeconds(endOfDay(dateRange[1]));

        setLoading(true);
        const infos = [];
        let allLogs = [];

        for (const tk of tokens) {
            if (SHOW_BALANCE) {
                try {
                    const usageRes = await API.get(`${baseUrl}/api/usage/token/`, {
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
                        infos.push({
                            token: tk,
                            valid: false,
                            error: (usageData && usageData.message) || '查询失败',
                        });
                    }
                } catch (e) {
                    infos.push({ token: tk, valid: false, error: '查询失败' });
                }
            }

            if (SHOW_DETAIL) {
                try {
                    const logRes = await API.get(`${baseUrl}/api/log/token`, {
                        params: {
                            start_timestamp: startTs,
                            end_timestamp: endTs,
                            page_size: 1000,
                        },
                        headers: { Authorization: `Bearer ${tk}` },
                    });
                    const body = logRes && logRes.data;
                    if (body && body.success && Array.isArray(body.data)) {
                        allLogs = allLogs.concat(
                            body.data.map((l) => ({ ...l, _token: tk })),
                        );
                    }
                } catch (e) {
                    // 单个令牌失败不影响其它令牌
                }
            }
        }

        allLogs.sort((a, b) => b.created_at - a.created_at);
        setTokenInfos(infos);
        setLogs(allLogs);
        const keys = [];
        if (SHOW_BALANCE) keys.push('1');
        if (SHOW_DETAIL) keys.push('2');
        setActiveKeys(keys);
        setModelFilter('all');
        setLoading(false);

        const validCount = infos.filter((i) => i.valid).length;
        if (SHOW_BALANCE && validCount === 0 && allLogs.length === 0) {
            Toast.error('查询失败，请检查令牌或站点地址是否正确');
        }
    };

    const importFromUsername = async () => {
        if (!importAccessToken.trim()) {
            Toast.warning('请输入站点访问令牌（Access Token）');
            return;
        }
        setImporting(true);
        try {
            const res = await API.get(`${baseUrl}/api/token/`, {
                params: { p: 1, size: 999 },
                headers: { Authorization: `Bearer ${importAccessToken.trim()}` },
            });
            const body = res && res.data;
            let records = [];
            if (body && body.success) {
                records = Array.isArray(body.data)
                    ? body.data
                    : (body.data && body.data.records) || [];
            }
            const keys = records
                .map((r) => (r.key && r.key.startsWith('sk-') ? r.key : `sk-${r.key}`))
                .filter((k) => TOKEN_REGEX.test(k));
            if (keys.length === 0) {
                Toast.error('未能导入任何令牌，请确认访问令牌是否正确，或该站点是否开放令牌列表接口');
            } else {
                setTokens((prev) => Array.from(new Set([...prev, ...keys])));
                Toast.success(`成功导入 ${keys.length} 个令牌`);
                setImportVisible(false);
                setImportUsername('');
                setImportAccessToken('');
            }
        } catch (e) {
            Toast.error('导入失败，请检查访问令牌与站点地址');
        }
        setImporting(false);
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

    const filteredLogs = useMemo(() => {
        return logs.filter(
            (l) => modelFilter === 'all' || l.model_name === modelFilter,
        );
    }, [logs, modelFilter]);

    const dailyRows = useMemo(
        () => aggregateLogsByDay(filteredLogs),
        [filteredLogs],
    );

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
            render: (text, record) =>
                record.type === 0 || record.type === 2 ? (
                    <Tag color="grey" size="large" onClick={() => copyText(text)}>
                        {text}
                    </Tag>
                ) : null,
            sorter: (a, b) => ('' + a.token_name).localeCompare(b.token_name),
        },
        {
            title: '模型',
            dataIndex: 'model_name',
            render: (text, record) =>
                record.type === 0 || record.type === 2 ? (
                    <Tag color={stringToColor(text)} size="large" onClick={() => copyText(text)}>
                        {text}
                    </Tag>
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
            render: (text, record) =>
                record.model_name && record.model_name.startsWith('mj_')
                    ? null
                    : record.type === 0 || record.type === 2
                    ? <span>{text}</span>
                    : null,
            sorter: (a, b) => a.prompt_tokens - b.prompt_tokens,
        },
        {
            title: '补全',
            dataIndex: 'completion_tokens',
            render: (text, record) =>
                parseInt(text) > 0 && (record.type === 0 || record.type === 2)
                    ? <span>{text}</span>
                    : null,
            sorter: (a, b) => a.completion_tokens - b.completion_tokens,
        },
        {
            title: '花费',
            dataIndex: 'quota',
            render: (text, record) =>
                record.type === 0 || record.type === 2 ? renderQuota(text, 6) : null,
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
                if (!other) {
                    return <Paragraph ellipsis={{ rows: 2 }}>{text}</Paragraph>;
                }
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
                text ? (
                    <Tag color="grey" size="large">{text}</Tag>
                ) : (
                    <Text type="tertiary">-</Text>
                ),
            sorter: (a, b) => ('' + a.token_name).localeCompare(b.token_name),
        },
        {
            title: '模型',
            dataIndex: 'model_name',
            render: (text) =>
                text ? (
                    <Tag color={stringToColor(text)} size="large" onClick={() => copyText(text)}>
                        {text}
                    </Tag>
                ) : null,
            sorter: (a, b) => ('' + a.model_name).localeCompare(b.model_name),
        },
        {
            title: '调用次数',
            dataIndex: 'count',
            sorter: (a, b) => a.count - b.count,
        },
        {
            title: '提示 Tokens',
            dataIndex: 'prompt_tokens',
            sorter: (a, b) => a.prompt_tokens - b.prompt_tokens,
        },
        {
            title: '补全 Tokens',
            dataIndex: 'completion_tokens',
            sorter: (a, b) => a.completion_tokens - b.completion_tokens,
        },
        {
            title: '花费',
            dataIndex: 'quota',
            render: (text) => renderQuota(text, 6),
            sorter: (a, b) => a.quota - b.quota,
        },
    ];

    // ====== 令牌信息表 ======
    const totalQuotaSpent = useMemo(
        () => filteredLogs.reduce((sum, l) => sum + (l.quota || 0), 0),
        [filteredLogs],
    );

    const exportTokenInfoCSV = (e) => {
        e && e.stopPropagation();
        const rows = tokenInfos.map((i) => ({
            令牌: maskToken(i.token),
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

    const tokenInfoColumns = [
        {
            title: '令牌',
            dataIndex: 'token',
            render: (text) => <Text type="tertiary">{maskToken(text)}</Text>,
        },
        { title: '名称', dataIndex: 'name', render: (t) => t || '未知' },
        {
            title: '状态',
            dataIndex: 'valid',
            render: (valid) =>
                valid ? (
                    <Tag color="green">有效</Tag>
                ) : (
                    <Tag color="red">无效</Tag>
                ),
        },
        {
            title: '总额',
            dataIndex: 'totalGranted',
            render: (t, r) =>
                !r.valid ? '未知' : r.unlimitedQuota ? '无限' : renderQuota(r.totalGranted, 3),
        },
        {
            title: '剩余额度',
            dataIndex: 'totalAvailable',
            render: (t, r) =>
                !r.valid ? '未知' : r.unlimitedQuota ? '无限制' : renderQuota(r.totalAvailable, 3),
        },
        {
            title: '已用额度',
            dataIndex: 'totalUsed',
            render: (t, r) =>
                !r.valid ? '未知' : r.unlimitedQuota ? '不计算' : renderQuota(r.totalUsed, 3),
        },
        {
            title: '有效期至',
            dataIndex: 'expiresAt',
            render: (t, r) =>
                !r.valid ? '未知' : r.expiresAt === 0 ? '永不过期' : renderTimestamp(r.expiresAt),
        },
    ];

    return (
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
            <Card>
                {siteKeys.length > 1 && (
                    <div style={{ marginBottom: 16 }}>
                        <Text strong style={{ marginRight: 8 }}>查询站点：</Text>
                        <Select
                            value={siteKey}
                            onChange={(v) => setSiteKey(v)}
                            style={{ width: 220 }}
                            optionList={siteKeys.map((k) => ({ value: k, label: k }))}
                        />
                    </div>
                )}

                {/* 令牌输入 + 添加 + 导入 */}
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
                    <Button icon={<IconImport />} theme="light" onClick={() => setImportVisible(true)}>
                        从用户名导入
                    </Button>
                </Space>

                {tokens.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                        <Space wrap>
                            {tokens.map((t) => (
                                <Tag
                                    key={t}
                                    color="blue"
                                    size="large"
                                    closable
                                    onClose={() => removeToken(t)}
                                >
                                    {maskToken(t)}
                                </Tag>
                            ))}
                            <Button
                                size="small"
                                theme="borderless"
                                type="danger"
                                icon={<IconClose />}
                                onClick={() => setTokens([])}
                            >
                                清空
                            </Button>
                        </Space>
                    </div>
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
            </Card>

            <Card style={{ marginTop: 24 }}>
                <Collapse activeKey={activeKeys} onChange={(keys) => setActiveKeys(keys)}>
                    {SHOW_BALANCE && (
                        <Panel
                            header="令牌信息"
                            itemKey="1"
                            extra={
                                <Button
                                    icon={<IconDownload />}
                                    theme="borderless"
                                    type="primary"
                                    onClick={exportTokenInfoCSV}
                                    disabled={tokenInfos.length === 0}
                                >
                                    令牌信息导出为CSV文件
                                </Button>
                            }
                        >
                            <Spin spinning={loading}>
                                {tokenInfos.length === 0 ? (
                                    <Empty description="暂无数据，请添加令牌后查询" style={{ padding: 24 }} />
                                ) : (
                                    <Table
                                        columns={tokenInfoColumns}
                                        dataSource={tokenInfos}
                                        rowKey="token"
                                        pagination={false}
                                        size="small"
                                    />
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
                                    <Tag shape="circle" color="green">
                                        汇总花费：{renderQuota(totalQuotaSpent, 4)}
                                    </Tag>
                                    <Button
                                        icon={<IconDownload />}
                                        theme="borderless"
                                        type="primary"
                                        onClick={exportDetailCSV}
                                        disabled={filteredLogs.length === 0}
                                    >
                                        调用详情导出为CSV文件
                                    </Button>
                                </div>
                            }
                        >
                            <Spin spinning={loading}>
                                {filteredLogs.length === 0 ? (
                                    <Empty description="暂无数据，请添加令牌后查询" style={{ padding: 24 }} />
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
                                        rowKey={(r) => `${r._token}-${r.id || r.created_at}-${Math.random()}`}
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

            <Modal
                title="从用户名导入令牌"
                visible={importVisible}
                onCancel={() => setImportVisible(false)}
                onOk={importFromUsername}
                okText="导入"
                cancelText="取消"
                confirmLoading={importing}
            >
                <Text type="secondary">
                    输入站点的「访问令牌（Access Token）」，将自动导入该账号下的全部令牌。
                </Text>
                <div style={{ marginTop: 16 }}>
                    <Text>用户名（可选）</Text>
                    <Input
                        value={importUsername}
                        onChange={setImportUsername}
                        placeholder="用于备注，不影响导入"
                        style={{ marginTop: 6 }}
                    />
                </div>
                <div style={{ marginTop: 16 }}>
                    <Text>访问令牌 Access Token</Text>
                    <Input
                        value={importAccessToken}
                        onChange={setImportAccessToken}
                        placeholder="在 NewAPI 个人设置中生成的访问令牌"
                        mode="password"
                        style={{ marginTop: 6 }}
                    />
                </div>
            </Modal>
        </div>
    );
};

export default LogsTable;
