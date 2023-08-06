'use strict';

module.exports.hello = async (event) => {
  const tablename = process.env.CONFIG_VALUES_TABLE;
  return {
    statusCode: 200,
    body: JSON.stringify(
      tablename
    ),
  };

  // Use this code if you don't use the http event with the LAMBDA-PROXY integration
  // return { message: 'Go Serverless v1.0! Your function executed successfully!', event };
};
