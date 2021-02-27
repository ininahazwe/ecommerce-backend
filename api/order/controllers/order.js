'use strict';
const {sanitizeEntity} = require('strapi-utils');
const stripe = require('stripe')(process.env.STRIPE_SK)

/**
 * Given a dollar amount, return the amount inc
 * @param {number} number
 */
const fromDecimalToInt = (number) => parseInt(number * 100)

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/concepts/controllers.html#core-controllers)
 * to customize this controller
 */

module.exports = {
  /**
   * Only send back orders from you
   * @param {*} ctx
   */
  async find(ctx) {
    const { user } = ctx.state
    let entities;
    if (ctx.query._q) {
      entities = await strapi.services.order.search({...ctx.query, user: user.id});
    } else {
      entities = await strapi.services.order.find({...ctx.query, user: user.id});
    }

    return entities.map(entity => sanitizeEntity(entity, { model: strapi.models.order }));
  },

  /**
   * Only returns 1 order, as long as it belogns to the user
   * @param {any} ctx
   */
  async findOne(ctx) {
    const { id } = ctx.params;
    const { user } = ctx.state

    const entity = await strapi.services.order.findOne({ id, user: user.id });
    return sanitizeEntity(entity, { model: strapi.models.order });
  },


  /**
   * Creates an order and sets up the Stripe Checkout session for the frontend
   * @param {any} ctx
   */
  async create(ctx) {
    const {product} = ctx.request.body

    if (!product){
      return ctx.throw(400, 'Please specify a product')
    }

    const realProduct = await strapi.services.product.findOne({id: product.id})
    if (!realProduct){
      return ctx.throw(400, 'No product with such id')
    }

    const { user } = ctx.state
    const BASE_URL = ctx.request.headers.origin || 'http://localhost:3000' //So we can redirect back

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: user.email, //Automatically added by Magic Link
      mode: "payment",
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: BASE_URL,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: realProduct.name
            },
            unit_amount: fromDecimalToInt(realProduct.price),
          },
          quantity: 1,
        }
      ]
    })

    //TODO Create Temp Order here
    const newOrder = await strapi.services.order.create({
      user: user.id,
      product: realProduct.id,
      total: realProduct.price,
      status: 'unpaid',
      checkout_session: session.id
    })

    return { id: session.id }
  },

  /**
   * Given a checkout_session, verifies payment and update the order
   * @param ctx
   * @returns {Promise<*|{}>}
   */
  async confirm(ctx) {
    const { checkout_session } = ctx.request.body
    console.log("checkout_session", checkout_session)
    const session = await stripe.checkout.sessions.retrieve(
      checkout_session
    )
    console.log("verify session", session)

    if(session.payment_status === "paid"){
      //Update order
      const updateOrder = await strapi.services.order.update({
          checkout_session
        },
        {
          status: 'paid'
        })

      return updateOrder

    } else {
      ctx.throw(400, "It seems like the order wasn't verified, please contact support")
    }
  }
};
