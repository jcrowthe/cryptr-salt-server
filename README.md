# Cryptr-Server
This repo houses the companion server module that turns your SaltStack salt master into a  [Cryptr](https://github.com/jcrowthe/cryptr)-enabled salt master.

##### Cryptr
> Cryptr is a secret store GUI built for secrets managed by SaltStack's GPG renderer. Using Salt's gpg renderer, you can securely save passwords, certificates, or other secrets on the salt master, where minions may request them as needed. Using Cryptr, a user may easily interact with the secrets in the saltstore, including reading and (eventually) modifying secrets easily.

Installing
----------
The following must be done on a linux-based salt master. Currently cryptr-server must be run as root in order to talk to Salt (however this will change in the near future).

```
cd /var && mkdir cryptr && cd cryptr
git clone https://github.com/jcrowthe/cryptr-server.git
npm install
```

Next you must edit index.js to point to your LDAP server.

```
vim index.js
```

Configure the following lines:

```
// =================== LDAP Configurations ======================
var ldapOU = 'CN=Cryptr-Auth';
var ldapURL = 'ldaps://example.com:636';
var ldapCN = 'CN=users,DC=ad,DC=example,DC=com';
var ldapENTRY = 'OU=Other,DC=ad,DC=example,DC=com';
```

Lastly, you must use Apache or nginx as a proxy for Cryptr-server, in order to handle HTTPS.

You may use something like the following. (Example config for CentOS 6.7 with Apache 2.2). In short, Cryptr-server listens for http connections on port 3353. You will need to proxy this via HTTPS, as the cryptr client requires an HTTPS URL.

```
<VirtualHost *:443>
    DocumentRoot /var/www/html
    ServerName example.com

    ErrorLog /var/log/ssl_error_log
    TransferLog /var/log/ssl_access_log
    LogLevel warn

    SSLEngine on
    SSLProtocol -ALL +TLSv1
    SSLCipherSuite ALL:!ADH:!EXPORT:!SSLv2:RC4+RSA:+HIGH:+MEDIUM:+LOW
    SSLCertificateFile /etc/ssl/certs/cert.crt
    SSLCertificateKeyFile /etc/ssl/certs/key.key
    SSLCertificateChainFile /etc/ssl/certs/intermediate.crt

    ProxyPass /cryptr http://localhost:3353
    ProxyPassReverse /cryptr http://localhost:3353
</VirtualHost>
```

Done!


Running
-------

```
npm start
```

In production environments, it is highly recommended to use software such as [pm2](https://www.npmjs.com/package/pm2) to keep cryptr-server always running, and maintain logs.


License
-------
MIT
