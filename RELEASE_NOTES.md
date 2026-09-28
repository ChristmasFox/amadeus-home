# Amadeus 1.6.7

- 新增仅限本机回环的 Kurisu TTS Tuner，可在不加载第二个模型的情况下比较 PROD/A/B/C、句级风格和 pinned OminiX 生成参数。
- 将 Kurisu 生产风格收敛到 Git 管理的 canonical 配置，加入受保护草稿、哈希绑定 proposal、显式 promotion 与热加载边界。
- 保持 `amadeus-tts`、`kurisu-v1`、`18792` 生产契约与生产优先调度，并补充 timing/RTF、CSRF、loopback 隔离和 owner 通知验收。
