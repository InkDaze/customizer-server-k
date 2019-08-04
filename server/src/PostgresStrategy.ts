import * as Knex from 'knex';
import * as pg from 'pg';
import uuidv4 from "uuid/v4";

const defaultConfig = {
    dialect: 'sqlite3',
    useNullAsDefault: true,
    connection: {
        filename: './db.sqlite3',
    },
};


/**
 *
 * @class PGStrategy
 * @constructor config {Object}  - DB configuration
 */
class PGStrategy {
    knex = Knex;
    constructor(config = defaultConfig) {
        this.knex = Knex(config);
    }

    storeShop({ shop, accessToken, data = {} }, done) {
        const uuid = uuidv4();
        this.knex
            .raw(
                `INSERT INTO products_shop (id, created, modified, shop_domain, access_token) VALUES ('${uuid}', now(), now(),'${shop}', '${accessToken}') ON CONFLICT DO NOTHING`
            )
            .then(result => {
                console.log(result);
                return done(null, accessToken);
            })
            .catch(e => {
                console.log(e);
                return done(e)
            })
    }

    getShop({ shop }, done) {
        this.knex('products_shop')
            .where('shop_domain', shop)
            .then(result => {
                return done(null, result);
            })
            .catch(e => {
                console.log(e);
                return false;
            })
    }

    async getShopAsync(shop_domain) {
        try {
            return await this.knex('products_shop').where('shop_domain', shop_domain);
        } catch(e) {
            console.log(e);
            return false;
        }
    }

    /**
     * Get all the products for a shop that has installed the app
     * @param shop_domain {String}
     * @return {Promise.<Object || False>}
     */
    async listProducts(shop_domain) {
        const knex = this.knex;
        try {
            let result =  await knex.select('products_product.id', 'product_id', 'name', 'pixie_options', 'style_options', 'field_options', 'general_options').from('products_product')
                .innerJoin('products_shop', function () {
                    this.on(function () {
                        this.on("products_shop.id","=","products_product.shop_id");
                        this.andOn("products_shop.shop_domain", "=", knex.raw('?', shop_domain));
                    })
                });
            return result;
        } catch(e) {
            console.log(e);
            return false;
        }
    }
    /**
     * Get a specific product
     * @param productId {String}
     * @return {Promise.<Object || False>}
     */
    async getProduct(productId) {
        const knex = this.knex;
        try {
            let result =  await knex.select('*').from('products_product')
                .where('product_id', productId);
            if(result.length >= 1) {
                return result[0]
            } else {
                return {};
            }
        } catch(e) {
            console.log(e);
            return false;
        }
    }



    /**
     * Update a product
     * @param product
     * @return {Promise.<*>}
     */
    async updateProduct(product) {
        const knex = this.knex;
        try {
            let result =  await knex("products_product").where('product_id', '=', product.product_id)
                .update(product);
            console.log(result);
            return {updated: true};
        } catch(e) {
            console.log(e);
            return {updated: false};
        }
    }
    /**
     * Add a product
     * @param product {Object}
     * @param shop {String}
     * @return {Promise.<*>}
     */
    async addProduct({shop, product}) {
        const knex = this.knex;
        const uuid = uuidv4();
        try {
            product.modified = "now()";
            product.created = "now()";

            let shopLookup = await knex.select("id").from("products_shop").where("shop_domain", "=", shop);
            if(shopLookup.length !== 1) {
                return false;
            }
            product.shop_id = shopLookup[0].id;
            product.id = uuid;

            let result =  await knex("products_product").insert(product, "id");
            product.id = result[0];
            delete(product.created);
            delete(product.modified);

            return product;
        } catch(e) {
            console.log(e);
            if(e.routine === "_bt_check_unique") {
                return {
                    error: "Product already exists!"
                }
            }
            return false;
        }
    }

    /**
     * Delete a product
     * @param productId
     * @return {Promise.<*>}
     */
    async deleteProduct(productId) {
        const knex = this.knex;
        try {
            let result =  await knex('products_product')
                .where('product_id', productId).del();
           console.log(result);
           return {deleted: true};
        } catch(e) {
            console.log(e);
            return {deleted: false};
        }
    }
}
module.exports = PGStrategy;