# Fixed calculation comparison case

Map: map_0004.json, 200 x 200 cells, 0.1m/cell (20m x 20m). Coordinates are integer (x,y), origin top-left; x right, y down. IDs start at zero. Each client demand is 100 Mbps.

Import model_prediction.json into wifi_mesh_simulator using the project JSON import. It contains the map, all 15 nodes, defaults, and a full non-wall indoor mask. This is the saved LR=0.0003 model prediction, not a new training run.

search_improved.json uses the same map/clients, with an offline search improvement. It is not a raw neural-network prediction and is not guaranteed globally optimal.

Both files set every non-wall cell as indoor so coverage has the same denominator as ap_mesh_update. Do not click rebuild indoor mask during comparison. The default 4dB access threshold tests association; demand satisfaction is a separate throughput metric. wifi_mesh_simulator currently displays radio/association, not RU/MCS/throughput.

## Model AP positions

|AP|X|Y|
|---|---:|---:|
|AP0|94|79|
|AP1|159|21|
|AP2|100|180|
|AP3|163|106|
|AP4|155|169|

## Model client reference

|Client|X|Y|Serving AP|RSSI (dBm)|SINR (dB)|Throughput (Mbps)|
|---|---:|---:|---|---:|---:|---:|
|C0|149|171|AP4|-22.80|64.900311|100.000000|
|C1|89|80|AP0|-20.93|42.029428|100.000000|
|C2|157|104|AP3|-22.80|46.362389|100.000000|
|C3|102|176|AP2|-20.76|48.222567|100.000000|
|C4|173|18|AP1|-48.64|32.798187|100.000000|
|C5|26|72|AP0|-55.54|30.758346|72.264706|
|C6|158|28|AP1|-23.77|46.061043|100.000000|
|C7|97|190|AP2|-48.03|37.276463|100.000000|
|C8|184|126|AP4|-55.55|8.073922|24.088235|
|C9|96|79|AP0|-20.76|47.699812|100.000000|

Detailed mesh SNR, interference power, SINR, RU and throughput references are in expected_results.json.

Model metrics: coverage 66.7437996915%; average throughput satisfaction 89.6352941176%; mesh 100%; total throughput 896.352941 Mbps. All clients are associated; C5 and C8 do not meet their full 100 Mbps demand.

Search-improved metrics: coverage 73.9082710336%; throughput satisfaction 100%; mesh 100%; total throughput 1000 Mbps.

Run node verify.mjs from this folder to compare the browser radio implementation with the saved native references.

## Compare using ap_mesh_update/test.py

From the ap_mesh_update directory:

```powershell
python test.py
```

The default map, 10 clients and 5 APs match model_prediction.json. The script now uses the same sequential placement/evaluation workflow and explicit radio/propagation parameters as training. It saves JSON, NPZ and plot_prediction_results images to test_results/fixed_map0004_case03.

To read the simulator project directly (instead of editing coordinates):

```powershell
python test.py --project ../wifi_mesh_simulator/examples/map0004_10clients_5aps/model_prediction.json --no-show
```

For the optional search-improved layout:

```powershell
python test.py --project ../wifi_mesh_simulator/examples/map0004_10clients_5aps/search_improved.json --output test_results/fixed_map0004_search --no-show
```

The default test.py case was reevaluated through the unmodified native propagation/environment functions using the documented NumPy CPU substitution during verification. All final allocation rows, Mesh edges, coverage and average satisfaction exactly match expected_results.json. Production test.py continues to use its normal Cal_db_gpu backend.

Client connection ratio is 100%, whereas mean throughput satisfaction is 89.6353% in the model layout. These measure association and achieved demand respectively; they should not be compared as if they were the same metric.
