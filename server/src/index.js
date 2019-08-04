require('isomorphic-fetch');
require('dotenv').config();
const cors = require('cors');
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const path = require('path');
const logger = require('morgan');
const jwt = require("jsonwebtoken");
const compression = require('compression');

const ShopifyAPIClient = require('shopify-api-node');
const ShopifyExpress = require('@shopify/shopify-express');
const PGStrategy = require("./PostgresStrategy.ts");

const knexConfig = {
    // your config here
    client: 'pg',
    version: "10.1",
    debug: process.env.NODE_ENV !== 'production',
    connection: {
        host : 'ec2-54-163-237-249.compute-1.amazonaws.com',
        user : 'fijejebhvjfkvm',
        password : '66b97e0569fe5dc7d0cd93f64cc31f69ab20c2b74565ffe370e6444a67cb18fe',
        database : 'dc5u5q3v5ej5ke',
        port: 5432,
        ssl: true
    }
};
const shopStore = new PGStrategy(knexConfig);
const {SHOPIFY_APP_KEY, SHOPIFY_APP_HOST, SHOPIFY_APP_HOST_PROD,SHOPIFY_APP_KEY_PROD, SHOPIFY_APP_SECRET_PROD, SHOPIFY_APP_SECRET, NODE_ENV} = process.env;
let CustomizerServer = require("./customizer");
const isDevelopment = process.env.NODE_ENV !== 'production';
console.log(`Is dev? ${isDevelopment}`);

const shopifyConfig = {
    host: (isDevelopment ? SHOPIFY_APP_HOST : SHOPIFY_APP_HOST_PROD),
    apiKey: (isDevelopment ? SHOPIFY_APP_KEY : SHOPIFY_APP_KEY_PROD),
    secret: (isDevelopment ? SHOPIFY_APP_SECRET : SHOPIFY_APP_SECRET_PROD),
    scope: ['write_orders, write_products', 'read_orders', 'read_products',"write_content","write_themes","write_script_tags", "write_customers"],
    shopStore: shopStore,
    afterAuth(request, response) {
        const {session: {accessToken, shop}} = request;

        //const shopify = new ShopifyAPIClient({shopName: shop.split(".myshopify.com")[0], accessToken: accessToken});
        return response.redirect('/');
    },
};

const scriptVersion = process.env.NOW_URL ? process.env.NOW_URL.split("customizer-server-")[1].split(".now.sh")[0] : "dev";

const app = express();
app.use(compression());
const bodyParser = require("body-parser");
app.use(bodyParser.json({limit: '50mb'}));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(logger('dev'));
app.use(
    session({
        store: isDevelopment ? new RedisStore() : new RedisStore({
            url: process.env.REDIS_HOST,
            pass: process.env.REDIS_PW
        }),
        secret: SHOPIFY_APP_SECRET,
        resave: true,
        saveUninitialized: false,
    })
);
app.use(cors());
// Run webpack hot reloading in dev
if (isDevelopment) {
    const webpack = require('webpack');
    const webpackMiddleware = require('webpack-dev-middleware');
    const webpackHotMiddleware = require('webpack-hot-middleware');
    const config = require('../config/webpack.config.js');
    const compiler = webpack(config);
    const middleware = webpackMiddleware(compiler, {
        hot: true,
        inline: true,
        publicPath: config.output.publicPath,
        contentBase: 'src',
        stats: {
            colors: true,
            hash: false,
            timings: true,
            chunks: false,
            chunkModules: false,
            modules: false,
        },
    });

    app.use(middleware);
    app.use(webpackHotMiddleware(compiler));
    const staticPath = path.resolve(__dirname, '../assets');
    app.use('/assets', express.static(staticPath));
}
else {
    const staticPath = path.resolve(__dirname, '../build');
    app.use('/build', express.static(staticPath));
    const staticAssetPath = path.resolve(__dirname, '../assets');
    app.use('/assets', express.static(staticAssetPath));
}

// Install
app.get('/install', (req, res) => res.render('install'));

// Create shopify middlewares and router
const shopify = ShopifyExpress(shopifyConfig);

// Mount Shopify Routes
const {routes, middleware} = shopify;
const {withShop, withWebhook} = middleware;

app.use('/', routes);

/**
 * GET THE MERCHANT SIDE APP*
 */
app.get('/', withShop, async function (request, response, next) {
    let {query: {shop}} = request;
    if(!shop) {
        shop = request.session.shop;
    }
    let shopEntry = await shopStore.getShopAsync(shop);
    if(!shopEntry) {
        return next("No shop registered with the app");
    }
    const accessToken =  shopEntry[0].access_token;
    const shopify = new ShopifyAPIClient({shopName: shop.split(".myshopify.com")[0], accessToken: accessToken});

    let appProducts = await shopStore.listProducts(shop),
        appProductIds = [];

    appProducts.forEach(function(product) {
        appProductIds.push(product.product_id);
    });

    const params = appProductIds.length > 0 ? {ids: appProductIds.toString()} : null;

    shopify.product.list(params).then(
        products => {
            //products = JSON.stringify(products, null, 0);
            appProducts.forEach(function(appProd) {
                let pIndex = products.findIndex(p => {return p.id === parseInt(appProd.product_id)});
                if( pIndex >= 0) {
                    appProd.image = products[pIndex].image;
                    appProd.type = products[pIndex].product_type ? products[pIndex].product_type : "";
                } else {
                    appProducts.splice(appProducts.indexOf(appProd));
                }
            });

            response.render('app', {
                title: 'Shopify Node App',
                apiKey: shopifyConfig.apiKey,
                shop: shop,
                products: JSON.stringify(appProducts, null, 0),
                appAuth: process.env.DJANGO_TOKEN,
                page: "products",
                rootURL: shopifyConfig.host,
                scriptSrc: (isDevelopment ? shopifyConfig.host + "/assets/settings.js" :
                    shopifyConfig.host + "/build/settings.js"),
                version: scriptVersion,
                env: process.env.NODE_ENV
            }
        )},
        err => {
            console.log(err);
            response.render('app', {
                title: 'Shopify Node App',
                apiKey: shopifyConfig.apiKey,
                shop: shop,
                products: [],
                appAuth: process.env.DJANGO_TOKEN,
                page: "products",
                rootURL: shopifyConfig.host,
                scriptSrc: (isDevelopment ? shopifyConfig.host + "/assets/main.js" : shopifyConfig.host + "/build/main.js"),
                version: scriptVersion,
                env: process.env.NODE_ENV
            })
        }
    );
});

app.get("/test-editor", async (request, response, next) => {
    const test = true;
    const shop = request.query.shop ? request.query.shop : process.env.NODE_ENV === "development" ?  "buildjawn.myshopify.com" : next;
    let shopEntry = (process.env.NODE_ENV === "development" && !test) ? [{accessToken: "4aeae6eb9334e7811ed3bc199943d721"}] : await shopStore.getShopAsync(shop);
    if(!shopEntry) {
        return next("No shop registered with the app");
    }
    const accessToken =  shopEntry[0].access_token,
        shopify = new ShopifyAPIClient({shopName: shop.split(".myshopify.com")[0], accessToken: accessToken});

    let appProducts = await shopStore.listProducts(shop),
        appProductIds = [];

    appProducts.forEach(function(product) {
        appProductIds.push(product.product_id);
    });
    let activeProduct = false,
        shopifyProduct = false;

    //If we have the product supplied in the params
    if(request.query.p) {
        let activeIndex = appProducts.findIndex((prod) => prod.product_id === request.query.p);
        activeProduct = activeIndex >= 0 ? appProducts[activeIndex] : null;
    } else if(appProductIds.length === 1) {
        activeProduct = appProducts[0];
    }

    if(!activeProduct) {
        let url = request.headers.referer;
        let handleFromUrl = url.split("/")[url.split("/").length - 1];
        try {
            let products = await shopify.product.list({handle: handleFromUrl});
            if(products.length > 0) {
                shopifyProduct = products[0];
            }
        } catch(e) {
            console.log(e);
        }
    }


    try {
        if(!activeProduct) {
            next();
        }
        if(!shopifyProduct) {
            shopifyProduct = await shopify.product.get(activeProduct.product_id);
        }
        activeProduct.type = shopifyProduct.product_type ? shopifyProduct.product_type : "";
        activeProduct.name = shopifyProduct.title;
        activeProduct.vendor = shopifyProduct.vendor;
        activeProduct.selectedVariant = 0;
        activeProduct.options = shopifyProduct.options;
        activeProduct.variants = shopifyProduct.variants;
        let shopInfo = await shopify.shop.get({});

        response.render('editor', {
                title: shopifyProduct.title + " | " + shopInfo.name,
                apiKey: shopifyConfig.apiKey,
                shop: shop,
                products: appProducts,
                appAuth: process.env.DJANGO_TOKEN,
                appShopAuth: jwt.sign(accessToken, process.env.JWT_SECRET),
                page: "customizer",
                rootURL: shopifyConfig.host,
                ogUrl: request.headers.http_host + request.query.path_prefix,
                activeProduct: JSON.stringify(activeProduct, null, 0),
                customer: JSON.stringify({
                    id: (request.query.cid ? JSON.parse(request.query.cid) : false),
                    email: (request.query.e ? JSON.parse(request.query.e) : false)
                }, null, 0),
                scriptSrc: (isDevelopment ? shopifyConfig.host + "/assets/main.js" :
                    shopifyConfig.host + "/build/main.js"),
                version: scriptVersion,
                env: process.env.NODE_ENV
            }
        );
    } catch(e) {
        next(e);
    }
});

app.use('/customizer', CustomizerServer.customizerRouter());
app.use("/app-api", CustomizerServer.apiRouter());

// Error Handlers
app.use(function (req, res, next) {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
});

app.use(function (error, request, response, next) {
    response.locals.message = error.message;
    response.locals.error = request.app.get('env') === 'development' ? error : {};

    response.status(error.status || 500);
    response.render('error');
});

module.exports = app;
