import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import BigCommerce from "node-bigcommerce";
import { create } from "xmlbuilder2";
import comboSkusHardCoded from "./combo-sku-lookup.json";
import states from "./us-states.json";
import { verify } from "jsonwebtoken";
import { format } from "date-fns";
import * as soap from "soap";

const { DynamoDB } = require("aws-sdk");

const S3 = new S3Client({ forcePathStyle: true });

const fetchConfigValues = async (fieldName) => {
  const db = new DynamoDB.DocumentClient();
  const configValueTable = process.env.CONFIG_VALUES_TABLE;
  const queryParams = {
    TableName: configValueTable,
    Key: { value: fieldName },
  };

  try {
    const data = await db.get(queryParams).promise();
    return data.Item ? JSON.parse(data.Item.data) : null;
  } catch (error) {
    // console.log(`Error fetching config values for ${fieldName}:`, JSON.stringify(error));
    return null;
  }
};

export const sqsHandler = async (event) => {
  const [record] = event.Records;
  const eventData = JSON.parse(record.body);

  const soapClient = await soap.createClientAsync(
    "https://eicloudservice.com/ePortalService.asmx?wsdl"
  );

  if (eventData && eventData.producer) {
    console.info(eventData);
    const { data } = eventData;
    const [, , eventType] = eventData.scope.split("/");

    const db = new DynamoDB.DocumentClient();
    const orderUpdateProcessingTable =
      process.env.ORDER_UPDATE_PROCESSING_TABLE;

    let processCreated = false;
    if (eventType === "created") {
      const bigCommerce = new BigCommerce({
        logLevel: "info",
        clientId: process.env.BC_CLIENT_ID,
        accessToken: process.env.BC_ACCESS_TOKEN,
        storeHash: process.env.BC_STORE_HASH,
        responseType: "json",
        apiVersion: "v2",
      });

      const orderId = data.id;
      const order = await bigCommerce.get(`/orders/${orderId}`);
      if (order.status_id === 11) processCreated = true;
      else console.debug("Order status id is not 11", JSON.stringify(order));
    }

    if (
      (data.id &&
        eventType === "statusUpdated" &&
        data.status?.new_status_id === 11) ||
      processCreated
    ) {
      // Check the database to see if we recently processed this order
      const item = await db
        .get({
          TableName: orderUpdateProcessingTable,
          Key: {
            OrderID: data.id,
          },
        })
        .promise();
      const processedAt = item?.Item?.ProcessedAt;
      const delta = processedAt
        ? Math.abs(processedAt - new Date().getTime())
        : null;
      if (delta && delta < 300000) {
        console.info(
          `Skipping Order Id ${data.id}, last processed at: ${processedAt}`
        );
        return;
      }

      // const cmsXml = await generateCmsXML([data.id]);
      //
      // await S3.send(new PutObjectCommand({
      //   Bucket: process.env.CMS_FTP_BUCKET,
      //   Key: `order-${data.id}.xml`,
      //   ContentType: 'application/xml',
      //   Body: cmsXml,
      // }));

      const eBridgeXmls = await generateEBridgeXMLs(data.id);
      const promises = [];
      for (const [index, eBridgeXml] of eBridgeXmls.entries()) {
        promises.push(
          S3.send(
            new PutObjectCommand({
              Bucket: process.env.CMS_FTP_BUCKET,
              Key: `to-ebridge/order-${data.id}-${Date.now()}-${index + 1}.xml`,
              ContentType: "application/xml",
              Body: eBridgeXml,
            })
          )
        );

        const filename =
          eBridgeXmls.length == 1
            ? `order-${data.id}.xml`
            : `order-${data.id}-${index + 1}.xml`;
        promises.push(
          soapClient.SendFileAsync({
            login: process.env.EBRIDGE_USERNAME,
            password: process.env.EBRIDGE_PASSWORD,
            content: eBridgeXml,
            filename: filename,
          })
        );
      }

      await Promise.all(promises);
      console.debug("Sent to eBridge");

      // Log that we processed this order
      await db
        .put({
          TableName: orderUpdateProcessingTable,
          Item: {
            OrderID: data.id,
            ProcessedAt: new Date().getTime(),
          },
        })
        .promise();
    }
  }
};

export const httpHandler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, GET",
    "Access-Control-Allow-Headers": "authorization",
    "Cache-Control": "no-cache",
  };

  try {
    const [, token] = event.headers.authorization
      ? event.headers.authorization.split(" ")
      : [];

    verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return {
      statusCode: 403,
      headers,
      body: "",
    };
  }

  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
    };
  }

  if (
    !event.queryStringParameters?.id ||
    !event.queryStringParameters?.storeHash
  ) {
    return {
      statusCode: 400,
      headers,
    };
  }

  const orderIds = event.queryStringParameters.id.split(",");

  try {
    return {
      statusCode: 200,
      headers: {
        ...headers,
        "Content-Type": "application/xml",
      },
      body: await generateCmsXML(orderIds),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers,
    };
  }
};

export const generateCmsXML = async (orderIds) => {
  const pizzaPackSkuOrder = (await fetchConfigValues("pizzaPackSkuOrder")) ?? [
    "C",
    "E",
    "S",
    "A",
    "R",
    "N",
    "M",
    "B",
    "I",
    "V",
    "H",
    "L",
    "X",
    "Y",
    "Z",
  ];
  // const pizzaPackSkuOrder = ['C', 'E', 'S', 'A', 'R', 'N', 'M', 'B', 'I', 'V', 'H', 'L', 'X', 'Y', 'Z'];

  const comboSkus =
    (await fetchConfigValues("comboSkus")) ?? comboSkusHardCoded;

  const bigCommerce = new BigCommerce({
    logLevel: "info",
    clientId: process.env.BC_CLIENT_ID,
    accessToken: process.env.BC_ACCESS_TOKEN,
    storeHash: process.env.BC_STORE_HASH,
    responseType: "json",
    apiVersion: "v2",
  });
  const orders = [];

  for (const orderId of orderIds) {
    bigCommerce.apiVersion = "v2";

    const [order, productCount, shippingAddresses] = await Promise.all([
      bigCommerce.get(`/orders/${orderId}`),
      bigCommerce.get(`/orders/${orderId}/products/count`),
      bigCommerce.get(`/orders/${orderId}/shipping_addresses`),
    ]);
    const productLimit = 200;
    const pages = Math.ceil(productCount.count / productLimit);
    const productResponses = await Promise.all(
      Array.from(Array(pages)).map((_, i) =>
        bigCommerce.get(
          `/orders/${orderId}/products?limit=${productLimit}&page=${i + 1}`
        )
      )
    );
    const products = productResponses.flat();
    const productsData = {};
    const recipients = [];

    bigCommerce.apiVersion = "v3";
    const transactions = await bigCommerce.get(
      `/orders/${orderId}/transactions`
    );

    products.forEach((product) => {
      const { sku, order_address_id: orderAddressId } = product;
      const productValues = {
        id: product.id,
        quantity: product.quantity,
        unitPrice: parseFloat(product.price_ex_tax),
      };
      let match;

      if (!productsData[orderAddressId]) {
        productsData[orderAddressId] = {};
      }

      if (/^LS\*/.test(sku)) {
        productsData[orderAddressId][product.id] = {
          ...productValues,
          warehouseSKU: "LS",
          skuParts: [],
        };
      } else if ((match = sku.match(/.*(?=\*)/)) && match.length > 0) {
        productsData[orderAddressId][product.id] = {
          ...productValues,
          warehouseSKU:
            product.product_options?.length > 0 ? `${match}-` : match,
          comboSKU: "",
        };
      } else if ((match = sku.match(/(?<=^\$).*/)) && match.length > 0) {
        const { quantity: parentQuantity } =
          productsData[orderAddressId][product.parent_order_product_id];
        const qtyDifference =
          parentQuantity > 1
            ? product.quantity / parentQuantity
            : product.quantity;

        if (
          productsData[orderAddressId][product.parent_order_product_id]
            .comboSKU !== undefined
        ) {
          productsData[orderAddressId][
            product.parent_order_product_id
          ].comboSKU += qtyDifference
            ? match[0].repeat(qtyDifference)
            : match[0];
        } else {
          productsData[orderAddressId][
            product.parent_order_product_id
          ].skuParts.push(`${match[0]}${qtyDifference || 1}`);
        }
      } else {
        productsData[orderAddressId][product.id] = {
          ...productValues,
          warehouseSKU: sku,
        };
      }
    });

    shippingAddresses.forEach((shippingAddress) => {
      let shipCode;
      let shipDate;
      let giftMessage;

      shippingAddress.form_fields.forEach((field) => {
        if (field.name === "shipCode" && field.value) {
          shipCode = field.value;
        } else if (
          field.name === "shipDate" &&
          field.value &&
          !isNaN(Date.parse(field.value))
        ) {
          shipDate = new Date(field.value).toISOString();
        } else if (field.name === "Gift Message" && field.value) {
          giftMessage = field.value;
        }
      });

      recipients.push({
        "@IsPurchaser": false,
        ShipToAddress: {
          ContactName: {
            FirstName: shippingAddress.first_name,
            LastName: shippingAddress.last_name,
            Company: shippingAddress.company || undefined,
          },
          Address: {
            AddressLine3: shippingAddress.street_1,
            AddressLine2: shippingAddress.street_2 || undefined,
            City: shippingAddress.city,
            State: states[shippingAddress.state],
            PostalCode: shippingAddress.zip,
            Email: shippingAddress.email,
          },
        },
        Item: Object.values(productsData[shippingAddress.id]).flatMap(
          (product) => {
            if (product.comboSKU) {
              const reveresedComboSKU = product.comboSKU
                .split("")
                .reverse()
                .join("");

              product.warehouseSKU +=
                comboSkus[product.comboSKU] || comboSkus[reveresedComboSKU];
            } else if (product.skuParts) {
              product.skuParts.sort(
                (a, b) =>
                  pizzaPackSkuOrder.indexOf(a.split("")[0]) -
                  pizzaPackSkuOrder.indexOf(b.split("")[0])
              );

              product.warehouseSKU += product.skuParts.join("");
            }

            return Array.from({ length: product.quantity }, () => ({
              ProductCode: product.warehouseSKU,
              OrderQuantity: 1,
              UnitPrice: product.unitPrice,
              TotalPrice: product.unitPrice,
              RefItemID: `${shippingAddress.id}-${product.id}`,
              DateToMoveInventory: shipDate,
              DateToFulfill: shipDate,
            }));
          }
        ),
        Package: {
          ShipMethod: {
            "@IndexBy": "Code",
            "#": shipCode,
          },
          ShippingCost: parseFloat(shippingAddress.cost_ex_tax),
        },
        GiftMessage: giftMessage,
      });
    });

    const [transaction] =
      transactions?.data?.length > 0 ? transactions.data : [];
    let payment;
    if (transaction && "amount" in transaction) {
      payment = {
        PaymentAmount: parseFloat(transaction.amount),
        PaymentType: "Bill Direct Customer",
      };
    }

    orders.push({
      DefaultShipMethod: {
        "@IndexBy": "Code",
        "@ThirdPartyBillingID": "",
        "#": "U1D",
      },
      OrderDate: !isNaN(Date.parse(order.date_created))
        ? new Date(order.date_created).toISOString()
        : undefined,
      OrderTotal: parseFloat(order.total_ex_tax),
      ItemTotal: parseFloat(order.subtotal_ex_tax),
      StateTaxes: parseFloat(order.total_tax),
      ShippingCharges: parseFloat(order.shipping_cost_ex_tax),
      Discount:
        parseFloat(order.discount_amount) + parseFloat(order.coupon_discount),
      RefOrderID: `BC${order.id}`,
      Notes: order.staff_notes || undefined,
      Customer: {
        ContactAddress: {
          ContactName: {
            FirstName: order.billing_address.first_name,
            LastName: order.billing_address.last_name,
            Company: order.billing_address.company || undefined,
          },
          Address: {
            AddressLine3: order.billing_address.street_1,
            AddressLine2: order.billing_address.street_2 || undefined,
            City: order.billing_address.city,
            State: states[order.billing_address.state],
            PostalCode: order.billing_address.zip,
            Email: order.billing_address.email,
          },
          PhoneNumber: order.billing_address.phone
            ? {
                PhoneNumDigits: order.billing_address.phone,
              }
            : undefined,
        },
      },
      Recipient: recipients,
      Payment: payment,
    });
  }

  const xmlObj = {
    CMSData: {
      Orders: {
        Order: orders,
      },
    },
  };
  const xmlDoc = create({ version: "1.0", encoding: "UTF-8" }, xmlObj);

  return xmlDoc.end({ prettyPrint: true });
};

const fetchBigCommerceOrderData = async (orderId) => {
  const bigCommerce = new BigCommerce({
    logLevel: "info",
    clientId: process.env.BC_CLIENT_ID,
    accessToken: process.env.BC_ACCESS_TOKEN,
    storeHash: process.env.BC_STORE_HASH,
    responseType: "json",
    apiVersion: "v2",
  });

  const [order, productCount, shippingAddresses, coupons] = await Promise.all([
    bigCommerce.get(`/orders/${orderId}`),
    bigCommerce.get(`/orders/${orderId}/products/count`),
    bigCommerce.get(`/orders/${orderId}/shipping_addresses`),
    bigCommerce.get(`/orders/${orderId}/coupons`),
  ]);

  const productLimit = 200;
  const pages = Math.ceil(productCount.count / productLimit);
  const productResponses = await Promise.all(
    Array.from(Array(pages)).map((_, i) =>
      bigCommerce.get(
        `/orders/${orderId}/products?limit=${productLimit}&page=${i + 1}`
      )
    )
  );
  const products = productResponses.flat();

  return { order, products, shippingAddresses, coupons };
};

const getPhoneContact = (phone) => {
  return {
    "core:ContactNumberTypeCoded": "TelephoneNumber",
    "core:ContactNumberValue": phone.replace(/\D/g, ""),
  };
};

const getEmailContact = (email) => {
  return {
    "core:ContactNumberTypeCoded": "EmailAddress",
    "core:ContactNumberValue": email,
  };
};

/**
 * Will generate one or more eBridge XML strings for a single order, one per shipping address
 *
 * @param orderId
 * @returns {Promise<string[]>}
 */
export const generateEBridgeXMLs = async (orderId) => {
  const { order, products, shippingAddresses, coupons } =
    await fetchBigCommerceOrderData(orderId);

  const xmlDocs = [];

  const gb = await fetchConfigValues("ghostBins");

  let ghostBins;
  if (!gb || gb.length === 0) {
    ghostBins = new Set([
      "LOUS-2DD",
      "LOUS-4DD",
      "LOUS-6DD",
      "LOUS-2TH1DD",
      "LOUS-2TH5DD",
      "LOUS-4TH",
      "LOUS-6TH",
      "LOUS-6DDTH",
      "LOUS-2TH5DD",
      "LOUS-7TH",
    ]);
  } else {
    ghostBins = new Set(gb);
  }

  // const ghostBins = new Set(["LOUS-2DD", "LOUS-4DD", "LOUS-6DD",
  //                             "LOUS-2TH1DD", "LOUS-2TH5DD", "LOUS-4TH",
  //                             "LOUS-6TH", "LOUS-6DDTH", "LOUS-2TH5DD", "LOUS-7TH",]);

  // Calculate percentages of total that a shipping address represents, used to assign
  // partial payment and discount amounts
  const totalsByShippingAddress = {};
  products.forEach((product) => {
    if (!(product.order_address_id in totalsByShippingAddress))
      totalsByShippingAddress[product.order_address_id] = 0;

    totalsByShippingAddress[product.order_address_id] += Number(
      product.total_inc_tax
    );
  });

  const totals = [];
  shippingAddresses.forEach((shippingAddress) => {
    // There have been scenarios with no products in a shipment
    totals.push(
      shippingAddress.id in totalsByShippingAddress
        ? totalsByShippingAddress[shippingAddress.id]
        : 0
    );
  });

  const totalProductCost = totals.reduce((a, b) => {
    return a + b;
  }, 0);
  const addressPercentages = totals.map((x) =>
    totalProductCost > 0 ? x / totalProductCost : 1
  );

  shippingAddresses.forEach((shippingAddress, shippingAddressIndex) => {
    let shipCode;
    let shipDate;
    let giftMessage;
    let orderType = "WEB";
    shippingAddress.form_fields.forEach((field) => {
      if (field.name === "shipCode" && field.value) {
        shipCode = field.value;
      } else if (
        field.name === "shipDate" &&
        field.value &&
        !isNaN(Date.parse(field.value))
      ) {
        shipDate = new Date(field.value);
      } else if (field.name === "Gift Message" && field.value) {
        giftMessage = field.value;
      } else if (field.name === "orderType" && field.value) {
        orderType = field.value.toUpperCase();
      }
    });

    if (!shipDate) shipDate = new Date(order.date_created);
    if (!shipCode) shipCode = "UGD";

    const shipToContacts = [];
    if (shippingAddress.phone)
      shipToContacts.push(getPhoneContact(shippingAddress.phone));

    if (shippingAddress.email)
      shipToContacts.push(getEmailContact(shippingAddress.email));

    const billToContacts = [];
    if (order.billing_address.phone)
      billToContacts.push(getPhoneContact(order.billing_address.phone));

    if (order.billing_address.email)
      billToContacts.push(getEmailContact(order.billing_address.email));

    const shippingAddressProducts = products.filter(
      (product) => product.order_address_id === shippingAddress.id
    );

    // General product map by id
    const productIdMap = shippingAddressProducts.reduce((map, product) => {
      map[product.id] = product;
      return map;
    }, {});

    // Generate all the line items by bundle parent (everything is considered to be a bundle to simplify things)
    // Also total up how many items in a single bundle, so that we can get the unit price
    const bundleItems = {};
    const bundleQuantity = {};
    shippingAddressProducts.forEach((product) => {
      const parentId = product.parent_order_product_id
        ? product.parent_order_product_id
        : product.id;
      if (!(parentId in bundleItems)) {
        bundleItems[parentId] = [];
        bundleQuantity[parentId] = 0;
      }

      const bins = product.bin_picking_number.split(",");

      // Sometimes bins will have something like "HOME-CHEESE, HOME-CHEESE,HOME-RONI",
      // need to reduce it to 2 HOME-CHEESE, and 1 HOME-RONI
      const combinedBins = Object.values(
        bins.reduce((prev, curr) => {
          const bin = curr.trim();
          if (!(bin in prev)) prev[bin] = { bin, quantity: 0 };

          prev[bin].quantity += 1;
          return prev;
        }, {})
      );

      combinedBins.forEach((obj) => {
        const { bin, quantity } = obj;
        if (ghostBins.has(bin)) return;

        bundleItems[parentId].push({
          product,
          bin,
          quantity: product.quantity * quantity,
        });

        bundleQuantity[parentId] += product.quantity * quantity;
      });
    });

    // Generate the Shipment info string, that tells GP which items needs to be shipped for the write back.
    // We just need to ship the parent items
    // const shipItems = [];
    // shippingAddressProducts.forEach(product => {
    //   shipItems.push(`${product.sku}:${product.quantity}`);
    // });
    // const shipmentInfoStr = shipItems.join(";");
    // const shipmentInfoStrParts = shipmentInfoStr.match(/.{1,200}/g);

    // Generate the XML for each line item - loop over shippingAddressProducts instead of bundle items, because I want
    // to preserve the order
    const productObjs = [];
    shippingAddressProducts.forEach((product) => {
      // Only want the bundle parents
      if (!(product.id in bundleItems)) return;

      const parentId = product.id;
      const items = bundleItems[parentId];
      const parent = productIdMap[parentId];
      items.forEach((item) => {
        const unitPrice = parent.total_ex_tax / bundleQuantity[parentId];

        const productObj = {
          BaseItemDetail: {
            LineItemNum: {
              "core:BuyerLineItemNum": productObjs.length + 1,
            },
            ItemIdentifiers: {
              "core:PartNumbers": {
                "core:SellerPartNumber": {
                  "core:PartID": item.bin,
                },
              },
            },
            TotalQuantity: {
              "@xsi:type": "core:QuantityType",
              "core:QuantityValue": item.quantity,
            },
          },
          PricingDetail: {
            "core:ListOfPrice": {
              "core:Price": {
                "core:UnitPrice": {
                  "core:UnitPriceValue": unitPrice.toFixed(3),
                },
              },
            },
          },
        };

        if (items.length > 1) {
          productObj["ListOfNameValueSet"] = {
            "core:NameValueSet": {
              "core:SetName": "DetailReferences",
              "core:ListOfNameValuePair": {
                "core:NameValuePair": [
                  {
                    "core:Name": "DetailComment",
                    "core:Value": parent.bin_picking_number,
                  },
                ],
              },
            },
          };
        }

        productObjs.push(productObj);
      });
    });

    // Check if any item is a subscription item
    let isSubscription = false;
    shippingAddressProducts.forEach((product) => {
      if (
        product.bin_picking_number.startsWith("POM") ||
        product.bin_picking_number.startsWith("PBM")
      )
        isSubscription = true;
    });

    let isGiftCard =
      shippingAddressProducts.length > 0 &&
      shippingAddressProducts.every((product) =>
        ["PGC", "PGC-LM"].includes(product.bin_picking_number)
      );
    let isVirtualGiftCard =
      shippingAddressProducts.length > 0 &&
      shippingAddressProducts.every((product) =>
        ["VGC", "VGC-LM"].includes(product.bin_picking_number)
      );

    let batchNumber = `WEB_${format(
      new Date(shipDate.valueOf() + shipDate.getTimezoneOffset() * 60 * 1000),
      "MMddyyyy"
    )}`;
    let paymentAmount = Number(
      order.total_inc_tax * addressPercentages[shippingAddressIndex]
    ).toFixed(3);
    let userDefined5 = paymentAmount;
    if (orderType.toUpperCase() != "WEB") batchNumber = orderType;
    if (isSubscription) {
      orderType = "SUBSCRIPTION";
      batchNumber = "SUBSCRIPTION";
      paymentAmount = "0.000";
    }
    if (isGiftCard) {
      orderType = "GIFTCARD";
      batchNumber = "GIFTCARD";
    }
    if (isVirtualGiftCard) {
      orderType = "EGIFTCARD";
      batchNumber = "EGIFTCARD";
    }

    const obj = {
      Order: {
        "@xmlns":
          "rrn:org.xcbl:schemas/xcbl/v4_0/ordermanagement/v1_0/ordermanagement.xsd",
        "@xmlns:core": "rrn:org.xcbl:schemas/xcbl/v4_0/core/core.xsd",
        "@xmlns:dgs": "http://www.w3.org/2000/09/xmldsig#",
        "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        OrderHeader: {
          OrderNumber: {
            BuyerOrderNumber: order.id,
            SellerOrderNumber:
              shippingAddresses.length == 1
                ? order.id
                : `${order.id}-${shippingAddressIndex + 1}`,
          },
          OrderIssueDate: new Date(order.date_created).toISOString(),
          OrderDates: {
            RequestedShipByDate: format(
              new Date(
                shipDate.valueOf() + shipDate.getTimezoneOffset() * 60 * 1000
              ),
              "yyyy-MM-dd"
            ),
          },
          OrderParty: {
            ShipToParty: {
              "@xsi:type": "core:PartyType",
              "core:ListOfIdentifier": {
                "core:Identifier": {
                  "core:Ident": "PRIMARY",
                },
              },
              "core:NameAddress": {
                "core:Name1":
                  `${shippingAddress.first_name} ${shippingAddress.last_name}`.toUpperCase(),
                "core:Street": shippingAddress.street_1.toUpperCase(),
                "core:StreetSupplement1": shippingAddress.street_2
                  ? shippingAddress.street_2.toUpperCase()
                  : undefined,
                "core:PostalCode": shippingAddress.zip,
                "core:City": shippingAddress.city.toUpperCase(),
                "core:Region": {
                  "core:RegionCoded": "Other",
                  "core:RegionCodedOther": states[shippingAddress.state],
                },
                "core:Country": {
                  "core:CountryCoded": "Other",
                  "core:CountryCodedOther": shippingAddress.country_iso2,
                },
              },
              "core:PrimaryContact": {
                "core:ContactName": shippingAddress.company
                  ? shippingAddress.company.toUpperCase()
                  : undefined,
                "core:ListOfContactNumber": {
                  "core:ContactNumber": shipToContacts,
                },
              },
            },
            BillToParty: {
              "@xsi:type": "core:PartyType",
              "core:ListOfIdentifier": {
                "core:Identifier": {
                  "core:Ident": "PRIMARY",
                },
              },
              "core:NameAddress": {
                "core:Name1":
                  `${order.billing_address.first_name} ${order.billing_address.last_name}`.toUpperCase(),
                "core:Street": order.billing_address.street_1.toUpperCase(),
                "core:StreetSupplement1": order.billing_address.street_2
                  ? order.billing_address.street_2.toUpperCase()
                  : undefined,
                "core:PostalCode": order.billing_address.zip,
                "core:City": order.billing_address.city.toUpperCase(),
                "core:Region": {
                  "core:RegionCoded": "Other",
                  "core:RegionCodedOther": states[order.billing_address.state],
                },
                "core:Country": {
                  "core:CountryCoded": "Other",
                  "core:CountryCodedOther": order.billing_address.country_iso2,
                },
              },
              "core:PrimaryContact": {
                "core:ContactName": order.billing_address.company
                  ? order.billing_address.company.toUpperCase()
                  : undefined,
                "core:ListOfContactNumber": {
                  "core:ContactNumber": billToContacts,
                },
              },
            },
            WarehouseParty: {
              "core:ListOfIdentifier": {
                "core:Identifier": {
                  "core:Ident": "MAIN",
                },
              },
            },
            BuyerParty: {
              "core:PartyID": {
                "core:Ident": "Lou Malnatis Pizzeria Big Commerce",
              },
              "core:ListOfIdentifier": {
                "core:Identifier": {
                  "core:Ident": "Lou Malnatis Pizzeria Big Commerce",
                },
              },
            },
            SellerParty: {
              "core:PartyID": {
                "core:Ident": "8475621814",
              },
              "core:ListOfIdentifier": {
                "core:Identifier": {
                  "core:Ident": "8475621814",
                },
              },
            },
          },
          ListOfNameValueSet: {
            "core:NameValueSet": [
              {
                "core:SetName": "HeaderReferences",
                "core:ListOfNameValuePair": {
                  "core:NameValuePair": [
                    {
                      "core:Name": "SOPType",
                      "core:Value": "2",
                    },
                    {
                      "core:Name": "DocumentTypeId",
                      "core:Value": orderType,
                    },
                    {
                      "core:Name": "BatchNumber",
                      "core:Value": batchNumber,
                    },
                    {
                      "core:Name": "ShipToPrintPhone",
                      "core:Value": "1",
                    },
                    {
                      "core:Name": "CustomerId",
                      "core:Value": order.customer_id,
                    },
                    {
                      "core:Name": "UserDefinedText3",
                      "core:Value": shippingAddress.id,
                    },
                  ],
                },
              },
              {
                "core:SetName": "TaxReferences",
                "core:ListOfNameValuePair": {
                  "core:NameValuePair": [
                    {
                      "core:Name": "TaxAmount",
                      "core:Value": Number(
                        order.total_tax *
                          addressPercentages[shippingAddressIndex]
                      ).toFixed(3),
                    },
                  ],
                },
              },
            ],
          },
          ListOfTransportRouting: {
            "core:TransportRouting": {
              "core:CarrierID": {
                "core:Ident": shipCode,
              },
            },
          },
          OrderAllowancesOrCharges: {
            "core:AllowOrCharge": [
              {
                "core:AllowanceOrChargeDescription": {
                  "core:ServiceCodedOther": "Discount",
                },
                "core:TypeOfAllowanceOrCharge": {
                  "core:MonetaryValue": {
                    "core:MonetaryAmount": (
                      (Number(order.discount_amount) +
                        Number(order.coupon_discount)) *
                      addressPercentages[shippingAddressIndex]
                    ).toFixed(3),
                  },
                },
              },
              {
                "core:AllowanceOrChargeDescription": {
                  "core:ServiceCodedOther": "Freight",
                },
                "core:TypeOfAllowanceOrCharge": {
                  "core:MonetaryValue": {
                    "core:MonetaryAmount": (
                      Number(order.shipping_cost_ex_tax) *
                      addressPercentages[shippingAddressIndex]
                    ).toFixed(3),
                  },
                },
              },
            ],
          },
        },
        OrderDetail: {
          ListOfItemDetail: {
            ItemDetail: productObjs,
          },
        },
      },
    };

    if (Number(paymentAmount) !== 0) {
      obj["Order"]["OrderHeader"]["ListOfNameValueSet"][
        "core:NameValueSet"
      ].push({
        "core:SetName": "PaymentReferences",
        "core:ListOfNameValuePair": {
          "core:NameValuePair": [
            {
              "core:Name": "PaymentAmount",
              "core:Value": paymentAmount,
            },
            {
              "core:Name": "CheckBookID",
              "core:Value":
                order.payment_method == "giftcertificate"
                  ? "GIFTCARD"
                  : "TOCCHASE",
            },
            {
              "core:Name": "PaymentType",
              "core:Value": 1,
            },
            {
              "core:Name": "PaymentDate",
              "core:Value": new Date(order.date_created).toISOString(),
            },
          ],
        },
      });
    }

    if (giftMessage && giftMessage.trim()) {
      const parts = giftMessage.trim().match(/.{1,50}/g);
      parts.slice(0, 3).forEach((part, index) => {
        obj["Order"]["OrderHeader"]["ListOfNameValueSet"][
          "core:NameValueSet"
        ][0]["core:ListOfNameValuePair"]["core:NameValuePair"].push({
          "core:Name": `Comment${index + 1}`,
          "core:Value": part,
        });
      });
    }

    if (Object.keys(coupons).length > 0) {
      const couponStr = coupons.map((x) => x.code).join(",");
      obj["Order"]["OrderHeader"]["ListOfNameValueSet"]["core:NameValueSet"][0][
        "core:ListOfNameValuePair"
      ]["core:NameValuePair"].push({
        "core:Name": `UserDefinedText1`,
        "core:Value": couponStr,
      });
    }

    if (isSubscription) {
      obj["Order"]["OrderHeader"]["ListOfNameValueSet"]["core:NameValueSet"][0][
        "core:ListOfNameValuePair"
      ]["core:NameValuePair"].push({
        "core:Name": `UserDefinedText5`,
        "core:Value": userDefined5,
      });
    }

    const xmlDoc = create({ version: "1.0", encoding: "UTF-8" }, obj);
    xmlDocs.push(xmlDoc.end({ prettyPrint: true }));
  });

  return xmlDocs;
};
