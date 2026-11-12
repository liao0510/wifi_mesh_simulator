# Wi-Fi Mesh Simulator v1.6

純 HTML / CSS / JavaScript 靜態網站，可部署 GitHub Pages。訊號與關聯模型對照同工作區的 `ap_mesh_update`，不需要 TensorFlow 或 Python 才能使用頁面。

## 使用

1. 開啟 `index.html` 或部署後的網址，匯入地圖 JSON。若瀏覽器限制 `file://` 的模組／JSON 載入，請透過本機 HTTP 伺服器開啟，例如在本資料夾執行 `python -m http.server 8000`，再開啟 `http://localhost:8000`。
2. 使用新增 AP／Client 工具在地圖點擊，或在左側「精準座標」選擇物件類型、輸入 X/Y，按「依座標新增」。
3. 點選地圖物件或右側節點列表，修改 X/Y，再按「移動選取物件到此座標」。也可以用滑鼠拖曳，放開後重新計算。
4. 座標是從 0 起算的整數格點，原點在左上；X 向右、Y 向下。每格 0.1 m。超出範圍、牆壁、禁止區域及室外位置均拒絕放置，不會自動改到其他座標。
5. 白實線表示達標的 AP–AP Mesh 邊；白虛線表示已成功關聯的 AP–Client 連線。未達 SINR 門檻的 client 不畫虛線。「顯示連線」可開關，Mesh 模式會強制顯示連線。
6. 節點、材質自訂損耗、手動室內 Mask 和無線參數都可匯出／匯入 JSON。舊專案中的 Gateway／Backhaul 設定不再參與計算；舊的共同 SINR 門檻會遷移為兩種門檻，之後可分開修改。匯入既有專案會保留其明確儲存的頻率及材質損耗，並依新規則重算。

## 與 ap_mesh_update 對齊的計算

對照來源：`config_radio.py`、`method/Cal_average_gpu.py`、`method/Cal_SNR.py`、`training_method/Network_environment.py`。

| 項目 | 計算／預設值 |
| --- | --- |
| 格點尺寸 | 0.1 m |
| 頻率／頻寬／發射功率／Noise Figure | 5210 MHz／80 MHz／20 dBm／7 dB |
| 最短傳播距離 | 0.5 m |
| 材質預設損耗 | ID 1、3、6、10 分別為 1、3、6、10 dB／格長 |
| 材質穿透 | 射線在每個材質格中的實際長度 × 該材質係數，斜向穿越依長度累加；只碰角點不加損耗 |
| FSPL | `32.44 + 20 log10(f_MHz) + 20 log10(d_km)` |
| RSSI | `TX power − FSPL − 穿透損耗`，四捨六入五成雙至小數兩位並儲存為 float32；接收點是牆壁時無訊號值 |
| Noise | `−174 + 10 log10(B_Hz) + NF`，預設約 −87.9691 dBm |
| AP–AP Mesh | RSSI 先限縮至 [−100, −20] dBm，再以 `SNR = RSSI − Noise`；雙向都 ≥ Mesh SNR 門檻（預設 4 dB）即保留該邊，包括環路 |
| 服務 Mesh | 最大連通分量；大小相同時，選包含最早加入 AP 的分量；單顆 AP 也是有效 Mesh。沒有 Gateway 或 Backhaul 瓶頸 |
| AP–Client | 使用未限縮的原始 RSSI；對每個候選 AP，直接加總 client 位置上其餘所有 AP 的線性接收功率作干擾 |
| SINR | `RSSI_desired − 10 log10(Noise_mW + Σ other_AP_power_mW)`；不平均 dBm，不以總功率減服務功率計算干擾 |
| Client 關聯 | 從服務 Mesh 中 SINR ≥ Client 門檻（預設 4 dB）的 AP 選 SINR 最高者；無合格者不關聯。RSSI 覆蓋門檻不參與關聯判定 |
| 干擾來源 | 所有其他 AP 一律同頻、持續發射；包含沒有 client 的 AP 及服務 Mesh 以外的 AP |

新增、刪除、移動 AP 或改變無線參數時，會重新計算 Mesh、所有 client 的候選 SINR 及關聯。Client 明細包含各候選 AP 的 RSSI、SNR、SINR、Mesh／門檻資格，以及服務 AP 的總干擾與雜訊。

RSSI／AP 區域熱圖使用服務 Mesh 的最強 AP；SINR 熱圖顯示服務 Mesh 中最佳候選的真實 SINR，低於門檻仍保留顏色供查詢，但不因此讓 client 連線。

## 統計及數值界限

- 頁面的覆蓋率分母維持「室內 Mask 的空白格」；`ap_mesh_update` 的部署評估通常使用整張地圖的空白格，因此相同訊號仍可能有不同的整體覆蓋率百分比。`forbidden` 禁止放置，不排除統計。
- Python 的 GPU 傳播幾何使用 float32，瀏覽器幾何使用 float64，再轉成相同的兩位小數 float32 RSSI。接近捨入邊界時可能相差 0.01 dB；恰在判定門檻附近時需考慮這個數值差異。無線公式及 Mesh／干擾／關聯規則相同。
- 本頁未加入 MCS、RU 或 throughput 計算；本次對齊的是 RSSI、AP–AP SNR、AP–Client SINR 及連線資格。沒有封包、CSMA、逐 AP 頻道或 RU 頻率位置模擬。
- 材質係數可自訂；若要與原專案比較，須使用相同地圖、節點、無線參數及預設材質損耗。

## 檔案及部署

上傳 `index.html` 和完整 `assets/`（包含 `radio.mjs`）至 GitHub Pages。`assets/app.js` 載入 `radio.mjs` 的計算核心；CSS／JS 使用 v1.6 快取版本。

## 驗證

在此資料夾執行 `node --test tests/*.test.mjs`。測試包含手算干擾案例、Mesh 分量／環路／門檻、座標／拖曳、連線虛線、專案匯出匯入，以及 Python 原專案產生的固定參考。

若需要重新產生參考資料，執行 `python tests/build_reference.py`；需要同層 `ap_mesh_update` 與 NumPy。腳本依原傳播程式註解所支援的 NumPy CPU 替代方式，執行未修改的原始傳播、Mesh 及 SINR 函式；加上 `--gpu` 可選用 CuPy／CUDA。參考程式 SHA256 及實際後端記錄於 `tests/reference_cases.json`，不修改原專案程式。
