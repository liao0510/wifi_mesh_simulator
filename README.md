# Wi-Fi Mesh Simulator

純 HTML / CSS / JavaScript 靜態網站，無需伺服器或套件建置，可直接部署 GitHub Pages。

## 檔案結構

```
index.html
assets/
  style.css
  app.js
  example1.json
```

## 使用

1. 將整個資料夾內容上傳至 GitHub 儲存庫根目錄（`index.html` 必須位於根目錄）。
2. 在 GitHub → Settings → Pages → Build and deployment，選 `Deploy from a branch`、`main`、`/(root)`，儲存。
3. 開啟 GitHub Pages URL。首次開啟會自動載入 `assets/example1.json`。
4. 點選「新增 AP」後在有效室內位置點擊；第一顆 AP 是 Gateway。再新增 Client。
5. 選取工具可以拖曳 AP / Client；放開時重算，左下角持續顯示座標。右鍵拖曳平移，滾輪縮放。
6. 匯入原始 `wall_map` JSON 或匯出的專案 JSON；匯出可保留 AP、Client、材質係數、室內手動修正和參數。

## 計算假設

- 一格為 0.1 m，地圖 100×100 對應 10×10 m。匯入不同格數時仍採 0.1 m / 格。
- RSSI (dBm) = AP Power (dBm) - FSPL (dB) - 穿越材質格子的損耗總和 (dB)。
- FSPL = 32.44 + 20log10(f_MHz) + 20log10(d_km)；最小距離 0.1 m。
- 預設玻璃 1、膠合木板 2、木頭 3、混凝土 8 dB/格，僅為可編輯的示範值，非實測。
- 使用沿 AP 到接收點的直線網格採樣，遇到每個材質格子加一次損耗。這是簡化的幾何穿透模型，沒有反射、繞射或角度校正。
- 忽略干擾時 SINR=SNR=RSSI−Noise，Noise=-174+10log10(B_Hz)+NF (dBm)。
- RSSI Heatmap 顯示各格最強 AP；AP 區域以最強 AP 歸屬，未達 RSSI 門檻會變暗。
- Mesh 採 Backhaul 頻率，雙向 SINR 都需達門檻，且須可透過多跳到第一顆 AP (Gateway)。目前所有 AP 共用 Backhaul 中心頻率與頻寬；不模擬多個 backhaul channel 或 channel scheduling。
- Client 以 Access 最高 SINR 選擇 AP，還須 RSSI / SINR 達標且服務 AP 能回到 Gateway。顯示最近 AP 與服務 AP。
- 覆蓋率分母是室內有效的空白格，室內區域透過邊界 Flood Fill 加手動修正取得。`forbidden` 僅禁止節點放置，不直接排除室內統計。
- 無 AP 時訊號統計顯示「—」。

## 限制

- 這是可互動的規劃展示工具，非經現場量測校正的射線追蹤模擬器。
- 不含 AP 間干擾、throughput、client airtime、PHY MCS、真實頻道配置及動態回程排程。
- 目前 Access / Backhaul 的中心頻率可以分開調整，但各 AP 共用對應頻率；尚未提供逐 AP 的 channel 配置。
- 由於 browser 的 `file://` 可能禁止 `fetch` 本地 JSON，直接雙擊 `index.html` 時若範例自動載入失敗，可手動匯入 `assets/example1.json`。在 GitHub Pages 則可正常載入。
