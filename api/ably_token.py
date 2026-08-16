# ably token api - issues short lived room scoped tokens, keeps real key server side
import os
import asyncio
from flask import Flask, request, jsonify
from ably import AblyRest

app = Flask(__name__)

# real key, only lives on server env vars
ABLY_API_KEY = os.environ.get("ABLY_API_KEY")


@app.route("/", defaults={"path": ""}, methods=["GET"])
@app.route("/<path:path>", methods=["GET"])
def get_token(path):
    # validate config
    if not ABLY_API_KEY:
        return jsonify({"error": "Server is missing ABLY_API_KEY."}), 500

    client_id = request.args.get("clientId", "anonymous")
    room = request.args.get("room")

    # room is required to scope the token
    if not room:
        return jsonify({"error": 'Missing "room" query parameter.'}), 400

    # ably sdk is async, wrap it
    async def create_token():
        client = AblyRest(ABLY_API_KEY)
        try:
            token_request = await client.auth.create_token_request(
                token_params={
                    "client_id": client_id,
                    "capability": {room: ["publish", "subscribe", "presence"]},
                    "ttl": 60 * 60 * 1000,  # 1hr
                }
            )
            return token_request.to_dict()
        finally:
            await client.close()

    # run + return token to client
    try:
        result = asyncio.run(create_token())
        return jsonify(result)
    except Exception as e:
        print("Failed to create Ably token request:", e)
        return jsonify({"error": "Failed to create token request."}), 500
