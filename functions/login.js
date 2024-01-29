const AWS = require('aws-sdk');
const { corsConfig } = require('./helpers');

AWS.config.update({ region: process.env.AWS_REGION || 'us-east-2' });

const cognito = new AWS.CognitoIdentityServiceProvider();

module.exports.handler = async (event) => {
    try {
        const { email, password } = JSON.parse(event.body);

        const user = await cognito.adminInitiateAuth({
            UserPoolId: process.env.USER_POOL_ID,
            ClientId: process.env.USER_POOL_CLIENT_ID,
            AuthFlow: 'ADMIN_NO_SRP_AUTH',
            AuthParameters: {
                USERNAME: email,
                PASSWORD: password
            }
        }).promise();

        return {
            statusCode: 200,
            headers: corsConfig.headers,
            body: JSON.stringify(user)
        };

    } catch (error) {
        console.log('login error', JSON.stringify(error));
        return {
            statusCode: 500,
            headers: corsConfig.headers,
            body: JSON.stringify(error)
        };
    }
};
