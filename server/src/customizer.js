const PGStrategy = require("./PostgresStrategy");
const request = require("request-promise");
const ShopifyAPIClient = require('shopify-api-node');
const knexConfig = {
    // your config here
    client: 'pg',
    version: "10.1",
    debug: process.env.NODE_ENV !== 'production',
    connection: {
        host: 'ec2-54-163-237-249.compute-1.amazonaws.com',
        user: 'fijejebhvjfkvm',
        password: '66b97e0569fe5dc7d0cd93f64cc31f69ab20c2b74565ffe370e6444a67cb18fe',
        database: 'dc5u5q3v5ej5ke',
        port: 5432,
        ssl: true
    }
};
const shopStore = new PGStrategy(knexConfig);
const express = require('express');
const path = require('path');
const jwt = require("jsonwebtoken");
const uuid = require('uuid/v4');
const md5 = require('md5');
const cloudinary = require("cloudinary");
cloudinary.config({
        cloud_name: process.env.CLOUDINARY_NAME,
        api_key: process.env.CLOUDINARY_KEY,
        api_secret: process.env.CLOUDINARY_SECRET
    });

class CustomizerServer {
    /**
     * @param options
     * @property options.products {Array<Int>} - Array of product ids
     * @property options.shop {string} - The shopify domain name
     * @property options.accessToken {string} - The shopify API access token
     */
    constructor(options) {
        const {products, shop, accessToken} = options;
        this.products = products;
        this.shop = shop;
        this.shopify = new ShopifyAPIClient({shopName: shop.split(".myshopify.com")[0], accessToken: accessToken});
    }

    /**
     * Checks to see if the shop snippet is enabled
     * @return {Promise.<boolean>}
     */
    async checkIfSnippetExists() {
        try {
            let theme = await this.shopify.theme.list({role: "main"});
            let asset = await this.shopify.asset.get(theme[0].id, {"asset[key]": "snippets/customizer.liquid"});
            if (asset.length > 0) {
                return asset;
            } else {
                return false;
            }
        } catch (e) {
            console.log(e);
            return false;
        }
    }

    /**
     *
     * @param productIds {array}
     * @return {string || boolean} - The snippet text
     */
    static snippetText(productIds) {
        if (!Array.isArray(productIds)) {
            return false;
        }
        return ("<script>\n" +
            "  const productIds = [" + productIds.toString() + "];\n" +
            "  const current = parseInt(\"{{ product.id }}\");\n" +
            "  productIds.forEach(function(id) {\n" +
            "    if(id === current) {\n" +
            "    \twindow.location.replace(\"/a/customizer?product=\" + current);\n" +
            "    }\n" +
            "  })\n" +
            "</script>")
    }

    async updateSnippet() {

    }

    async renderApp(req, res) {


    }

    static customizerRouter() {
        const router = express.Router();
        /**
         * GET THE CUSTOMIZER APP
         */
        router.use('/assets', express.static(path.resolve(__dirname, '../app/public/assets')));

        router.get("/", async function (req, res) {
            const productId = req.query.product;
            const {shop} = req.query.shop;
            let product = await shopStore.getProduct(productId);
            console.log(product);

            res.render("customizer");
        });
        return router;

    }

    /**
     * Adds the routes for the admin API for saving in the App database
     * @return {express.router} - Express Router
     */
    static apiRouter() {
        const router = express.Router();
        router.use(validateAppApi);

        /**
         * Function to validate calls to the internal App API
         */
        function validateAppApi(req, res, next) {
            const token = req.headers.hasOwnProperty("authorization") ? req.headers.authorization : false;
            if (!token) {
                res.status(401);
                return res.json({
                    error: 'No Authorization Token Provided'
                });
            } else if (token !== process.env.DJANGO_TOKEN) {
                res.status(401);
                return res.json({
                    error: 'Authorization Token Incorrect'
                });
            } else {
                next();
            }
        }

        function validateClientFrontend(req, res, next) {
            if (!req.query.shop || !req.headers.appshopauth) {
                return res.status(400).json({error: "Must provide shop domain, as well as App Shop Auth"});
            } else {
                next();
            }
        }

        function createClientFrontend(req, res, next) {
            const shop = req.query.shop;
            const accessToken = jwt.verify(req.headers.appshopauth, process.env.JWT_SECRET);
            return new ShopifyAPIClient({shopName: shop.split(".myshopify.com")[0], accessToken: accessToken});
        }

        /**
         * Individual GET product endpoint
         */
        router.get('/products/:product_id', async (req, res, next) => {
            const productId = req.params.product_id;
            let result = await shopStore.getProduct(productId);
            res.json(result);
        });

        /**
         * LIST products for a shop
         */
        router.get('/products', async (req, res, next) => {

            const {shop_domain} = req.query;
            if (shop_domain === undefined) {
                res.status(400);
                res.json({
                    message: "You must provide both shop_domain and product params"
                })
            }
            else {
                let result = await shopStore.listProducts(shop_domain);
                res.json(result);
            }

        });

        /**
         * Update product for a shop
         */
        router.put('/products', async (req, res, next) => {

            const product = req.body;
            delete(product.type);
            delete(product.image);
            if (!product.hasOwnProperty("product_id")) {
                res.status(400);
                res.json({
                    message: "You must provide product_id fool!"
                })
            } else {
                let result = await shopStore.updateProduct(product);
                res.json(result);
            }


        });
        /**
         * Create a product for a shop
         */
        router.post('/products', async (req, res, next) => {
            const {product, shop_domain} = req.body;
            if (!product) {
                res.status(400);
                res.json({message: "You must provide products fool!"})
            }
            else {
                let result = await shopStore.addProduct(req.body);
                res.json({id: result.id});
            }

        });
        /**
         * Delete a product for a shop
         */
        router.delete('/products/:productId', async (req, res, next) => {
            const productId = req.params.productId;
            let result = await shopStore.deleteProduct(productId);
            res.json(result);

        });


        /**
         * Validate that an encoded auth token and shop domain are coming with these requests
         */
        router.use("/customer", validateClientFrontend);
        router.use("/design", validateClientFrontend);

        router.post("/customer/create", async (req, res, next) => {
            const shopify = createClientFrontend(req, res, next);
            const {email} = req.body;
            if (!email) {
                return res.status(400).json({error: "Must provide email"});
            }
            try {
                let customer = await getCustomer(shopify, email);
                if (!customer) {
                    customer = await shopify.customer.create({email: email, accepts_marketing: true});
                }
                res.json({customer: customer});
                try {
                    await createSubscriber(email);
                } catch(e) {
                    console.error(e);
                }
            } catch (e) {
                res.status(e.statusCode).json({error: e.statusMessage});
            }
        });
        /**
         * Search for customer by email to get ID and meta
         *
         * @param req.query.email {String} || req.query.id {Int}
         * @param req.headers.authorization {String}
         * @param req.headers.appshopauth {String} JWT encoded app token
         *
         * @return res
         * @property res.customer {Object || False }
         * @property res.metafields {Object || False }
         */
        router.get("/customer", async (req, res, next) => {
            if (!req.query.email && !req.query.id) {
                res.status(400);
                res.json({error: "Please provide either email or customer ID"});
                return;
            }
            const shopify = createClientFrontend(req, res, next);
            try {
                let customerId,
                    customer;
                if (!req.query.id) { //do Lookup by email search
                    customer = await getCustomer(shopify, req.query.email);
                    if (!customer) {
                        return res.json({customer: false, metafields: []});
                    }
                    customerId = customer.id;
                }
                else {
                    customerId = req.query.id;
                    customer = {id: customerId};
                }

                let meta = await shopify.metafield.list({
                    metafield: {
                        owner_resource: 'customer',
                        owner_id: customerId
                    }
                });
                res.json({customer: customer, metafields: meta});
            }
            catch (e) {
                console.log(e);
                next(e);
            }
        });

        async function getCustomer(shopify, email) {
            let search = await shopify.customer.search({
                limit: 1,
                query: `email:${email}`,
                fields: "email,id"
            });
            return search.length > 0 ? search[0] : false;
        }

        /**
         * Create a customer (if not found by email) and a design entry
         *
         * @param req.body.email {String}
         * @param req.body.design {{name: string, thumbnail: string, canvas: Object}}
         */
        router.post("/customer", async (req, res, next) => {
            const shopify = createClientFrontend(req, res, next);
            const {design, email} = req.body;
            if (!design || !email) {
                return res.status(400).json({error: "Must provide design and email"});
            }
            try {
                let customer = await getCustomer(shopify, email);
                if (!customer) {
                    customer = await shopify.customer.create({email: email, accepts_marketing: true});
                }
                let metafield = await createCustomerMetafield(shopify, customer.id, design);
                res.json({customer: customer, metafield: metafield});
                design.id = metafield.id;
                await postToMailchimpWorkflow(email, design);
            } catch (e) {
                return res.status(e.statusCode).json({error: e.statusMessage});
            }
        });

        async function createSubscriber(email) {
            try {
                let now = new Date();
                let idHash = md5(email.toLowerCase());
                let newSub = await request(`https://us12.api.mailchimp.com/3.0/lists/111620a437/members/${idHash}`, {
                    method: "PUT",
                    headers: {"Authorization": "apikey 98279030f13fe48e82c2b3cb326e05d8-us12"},
                    body: {email_address: email, status_if_new: "subscribed"},
                    json: true
                });
                if(newSub && (new Date(newSub.timestamp_opt)) > now) {
                    await request(`https://us12.api.mailchimp.com/3.0/lists/111620a437/members/${idHash}/tags`, {
                        method: "POST",
                        headers: {
                            "Authorization": "apikey 98279030f13fe48e82c2b3cb326e05d8-us12"
                        },
                        body: {
                            tags: [{name: "DesignSignup", status: "active"}]
                        },
                        json: true
                    });
                }
            }
            catch (e) {
                console.error(e);
            }
        }

        /**
         * Creates a subscriber and adds the merge tags
         * @param email
         * @param design {{id, thumbnail, name}}
         * @return {Promise<void>}
         */
        async function postToMailchimpWorkflow(email, design) {
            try {

                let uploadResult = await cloudinary.v2.uploader.upload(design.thumbnail, {
                    public_id: `${email}/${design.name}`,
                    transformation: {
                        effect: "trim:10"
                    }
                });
                let idHash = md5(email.toLowerCase());
                await request(`https://us12.api.mailchimp.com/3.0/lists/111620a437/members/${idHash}`, {
                    method: "PUT",
                    headers: {
                        "Authorization": "apikey 98279030f13fe48e82c2b3cb326e05d8-us12"
                    },
                    body: {
                        email_address: email,
                        merge_fields: {
                            RECENTCUST: uploadResult.url,
                            SAVEDCUST: (new Date()).toLocaleDateString(),
                            CUSTID: design.id
                        },
                        status_if_new: "subscribed"
                    },
                    json: true
                });
                await request(`https://us12.api.mailchimp.com/3.0/lists/111620a437/members/${idHash}/tags`, {
                    method: "POST",
                    headers: {
                        "Authorization": "apikey 98279030f13fe48e82c2b3cb326e05d8-us12"
                    },
                    body: {
                        tags: [
                            {name: "Design", status: "active"}
                        ]
                    },
                    json: true
                });
                await request(`https://us12.api.mailchimp.com/3.0/automations/a1816cd5d6/emails/d0caf51987/queue`,{
                    method: "POST",
                    headers: {"Authorization": "apikey 98279030f13fe48e82c2b3cb326e05d8-us12"},
                    body: {email_address: email},
                    json: true
                })
            }
            catch (e) {
                console.error(e);
            }
        }

        /**
         * Create a design for an existing customer. If same name used, return error
         *
         * @param req.body.design {Object}
         */
        router.post("/customer/:id", async (req, res, next) => {
            const shopify = createClientFrontend(req, res, next),
                customerId = req.params.id,
                {design, email} = req.body;

            if (!design) {
                res.status(400);
                res.json({error: "Must provide design"});
            }
            try {
                let metafield = await createCustomerMetafield(shopify, customerId, design);
                res.json({customer: {id: customerId}, metafield: metafield});
                design.id = metafield.id;
                await postToMailchimpWorkflow(email, design);
            } catch (e) {
                res.status(e.statusCode ? e.statusCode : 400);
                res.json({error: e.statusMessage});
            }
        });

        /**
         * We need metafield ID's, so everyone creates them the same way
         * @param shopify
         * @param customerId
         * @param design
         * @return {Promise<Shopify.IMetafield>}
         */
        async function createCustomerMetafield(shopify, customerId, design) {
            const designId = uuid.v4();
            return await shopify.metafield.create({
                key: designId,
                value: JSON.stringify(design),
                value_type: "string",
                namespace: "customizer",
                owner_resource: 'customer',
                owner_id: customerId
            });
        }

        /**
         * Update a design
         * @param req.body.email {String}
         * @param req.body.design {Object}
         */
        router.put("/design/:designId", async (req, res, next) => {
            const shopify = createClientFrontend(req, res, next),
                {designId} = req.params,
                {design} = req.body;

            if (!design) {
                res.status(400);
                res.json({error: "Must provide design"});
            }
            try {
                let metafield = await shopify.metafield.update(designId, {
                    value: JSON.stringify(design),
                    value_type: "string"
                });
                res.json(metafield)
            } catch (e) {
                res.status(e.statusCode);
                res.json({error: e.statusMessage});
            }
        });

        /**
         * Delete a design
         * @param req.body.email {String}
         * @param req.body.design {Object}
         */
        router.delete("/design/:designId", async (req, res, next) => {
            const shopify = createClientFrontend(req, res, next),
                {designId} = req.params;
            try {
                let metafield = await shopify.metafield.delete(designId);
                res.json(metafield)
            } catch (e) {
                res.status(e.statusCode);
                res.json({error: e.statusMessage});
            }
        });


        return router;
    }

}

module.exports = CustomizerServer;