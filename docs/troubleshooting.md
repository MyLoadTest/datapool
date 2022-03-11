# Troubleshooting the Datapool


## Cannot access remotely (Windows)

1.  Open http://<servername>:3000 in browser

2.  Is the datapool listening on the expected port?
    ```cmd.exe
    # Is the datapool server listening on a public IP address?

    C:\TEMP\datapool\server\>netstat -ano | find "3000" | find "LISTEN"
    TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4656
    TCP    [::]:3000              [::]:0                 LISTENING       4656
    ```
3.  Check EC2 Security Groups
4.  Control Panel > Windows Firewall > Advanced settings > Inbound Rules > New Rule (TCP:3000)


## Cannot access remotely (Linux)

```bash
# can I access locally?
curl http://localhost:3000

# show listening ports
$ lsof -nP -iTCP -sTCP:LISTEN
COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    23411 stuart   24u  IPv6 235776      0t0  TCP *:3000 (LISTEN)
```


## Crashes when calling /code/{module}/{function}

Are all the modules required by the user-code installed?

```bash
cd ./usercode
npm install <module>
```

Can you use the uploaded module from your own locally running program?

```JavaScript
const module = require('the-module');
console.log(module.function(args));
```
